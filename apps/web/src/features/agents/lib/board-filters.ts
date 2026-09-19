// Shared by the server page (reading the URL) and the client board.

export const SORTS = ["Mcap", "Volume", "New"] as const;
export type Sort = (typeof SORTS)[number];

export const STAGES = ["all", "pre-graduation", "graduated"] as const;
export type StageFilter = (typeof STAGES)[number];

export const VIEWS = ["grid", "table"] as const;
export type BoardView = (typeof VIEWS)[number];

export interface BoardFilters {
  sort: Sort;
  stage: StageFilter;
  query: string;
  view: BoardView;
}

type Search = Record<string, string | string[] | undefined>;

const one = (value: string | string[] | undefined) =>
  typeof value === "string" ? value : undefined;

export function readBoardFilters(search: Search): BoardFilters {
  return {
    sort: SORTS.find((s) => s === one(search.sort)) ?? "Mcap",
    stage: STAGES.find((s) => s === one(search.stage)) ?? "all",
    query: (one(search.q) ?? "").slice(0, 80),
    view: VIEWS.find((v) => v === one(search.view)) ?? "grid",
  };
}

export function boardSearch(filters: BoardFilters): string {
  const params = new URLSearchParams();
  if (filters.sort !== "Mcap") {
    params.set("sort", filters.sort);
  }
  if (filters.stage !== "all") {
    params.set("stage", filters.stage);
  }
  if (filters.query) {
    params.set("q", filters.query);
  }
  if (filters.view !== "grid") {
    params.set("view", filters.view);
  }
  return params.toString();
}
