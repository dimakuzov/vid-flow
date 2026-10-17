"use client";

import { useCallback, useEffect, useReducer } from "react";
import { useT } from "@/components/language";
import type { StageDetail } from "@/lib/series/types";
import { requestJson, stageApiPath } from "./api";

export const DOC_FIELDS = ["prompt", "llmNotes", "refs", "workflow", "speech"] as const;
export type DocField = (typeof DOC_FIELDS)[number];
export type Docs = Record<DocField, string>;

/**
 * Поле документа на странице.
 * `dirty` — пользователь правил поле после последнего сохранения/подтягивания.
 * `base` — текст файла на диске в момент, когда правка началась: если файл на диске
 * с тех пор изменился, поле показывает плашку «подтянуть?».
 */
export interface FieldState {
  value: string;
  dirty: boolean;
  base: string;
}

export interface StageDocsState {
  detail: StageDetail;
  fields: Record<DocField, FieldState>;
}

export type StageDocsAction =
  | { type: "edit"; field: DocField; value: string }
  /** Данные с диска (опрос, загрузка файла). Локальные правки не трогаются. */
  | { type: "merge"; detail: StageDetail }
  /** Поля только что сохранены на диск: всё берётся из ответа. */
  | { type: "reset"; detail: StageDetail }
  /** Взять текст файла с диска вместо локальной правки. */
  | { type: "pull"; field: DocField }
  /** Оставить локальную правку, плашку убрать. */
  | { type: "keep"; field: DocField };

function diskText(detail: StageDetail, field: DocField): string {
  return detail.docs[field] || "";
}

export function cleanFields(detail: StageDetail): Record<DocField, FieldState> {
  const fields = {} as Record<DocField, FieldState>;
  for (const field of DOC_FIELDS) {
    const text = diskText(detail, field);
    fields[field] = { value: text, dirty: false, base: text };
  }
  return fields;
}

export function stageDocsReducer(state: StageDocsState, action: StageDocsAction): StageDocsState {
  switch (action.type) {
    case "edit": {
      const current = state.fields[action.field];
      const base = current.dirty ? current.base : diskText(state.detail, action.field);
      return {
        ...state,
        fields: { ...state.fields, [action.field]: { value: action.value, dirty: true, base } },
      };
    }
    case "merge": {
      const fields = { ...state.fields };
      for (const field of DOC_FIELDS) {
        if (fields[field].dirty) continue;
        const text = diskText(action.detail, field);
        fields[field] = { value: text, dirty: false, base: text };
      }
      return { detail: action.detail, fields };
    }
    case "reset":
      return { detail: action.detail, fields: cleanFields(action.detail) };
    case "pull": {
      const text = diskText(state.detail, action.field);
      return {
        ...state,
        fields: { ...state.fields, [action.field]: { value: text, dirty: false, base: text } },
      };
    }
    case "keep": {
      const current = state.fields[action.field];
      return {
        ...state,
        fields: {
          ...state.fields,
          [action.field]: { ...current, base: diskText(state.detail, action.field) },
        },
      };
    }
  }
}

/** Файл на диске изменился, пока поле правили, и отличается от того, что в поле. */
export function hasDiskConflict(field: FieldState, disk: string): boolean {
  return field.dirty && disk !== field.base && disk !== field.value;
}

const POLL_MS = 4000;

/**
 * Этап: данные с диска, опрос раз в 4 с и слияние с несохранёнными правками полей.
 */
export function useStageDetail(initialDetail: StageDetail) {
  const [state, dispatch] = useReducer(stageDocsReducer, initialDetail, (detail) => ({
    detail,
    fields: cleanFields(detail),
  }));
  const t = useT();
  const { episodeId, shotId, stageId } = initialDetail;
  const stageApi = stageApiPath(episodeId, shotId, stageId);

  const reload = useCallback(async () => {
    const data = await requestJson<StageDetail>(stageApi, {
      fallbackError: t("page.openFailed"),
    });
    dispatch({ type: "merge", detail: data });
    return data;
  }, [stageApi, t]);

  useEffect(() => {
    let stopped = false;
    let inFlight = false;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible" || inFlight) return;
      inFlight = true;
      requestJson<StageDetail>(stageApi)
        .then((data) => {
          if (!stopped) dispatch({ type: "merge", detail: data });
        })
        .catch(() => {
          // Папка этапа будет прочитана на следующем тике.
        })
        .finally(() => {
          inFlight = false;
        });
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [stageApi]);

  const docs = Object.fromEntries(
    DOC_FIELDS.map((field) => [field, state.fields[field].value]),
  ) as Docs;
  const dirty = DOC_FIELDS.some((field) => state.fields[field].dirty);

  return {
    detail: state.detail,
    fields: state.fields,
    docs,
    dirty,
    stageApi,
    reload,
    edit: useCallback((field: DocField, value: string) => dispatch({ type: "edit", field, value }), []),
    merge: useCallback((detail: StageDetail) => dispatch({ type: "merge", detail }), []),
    reset: useCallback((detail: StageDetail) => dispatch({ type: "reset", detail }), []),
    pull: useCallback((field: DocField) => dispatch({ type: "pull", field }), []),
    keep: useCallback((field: DocField) => dispatch({ type: "keep", field }), []),
  };
}

export type StageDetailHandle = ReturnType<typeof useStageDetail>;
