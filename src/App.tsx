import { useEffect, useMemo, useState } from "react";
import { Database, RefreshCw, UsersRound } from "lucide-react";
import { Slider } from "@/components/ui/slider";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const HEATMAP_API =
  "https://sevenx-tmap-api-rarmirbpcd.cn-hangzhou.fcapp.run/api/heatmap";

type Campus = "高新" | "林荫";
type CohortRow = {
  id: string;
  year: number;
  gaoxin: number;
  linyin: number;
};
type ApiCohortConfig = {
  year: number | string;
  campus_class_counts?: Partial<Record<Campus, number>>;
};
type HeatmapCellValue =
  | number
  | {
      count: number;
      titles?: string[];
    };
type Snapshots = Record<
  string,
  Record<string, Partial<Record<Campus, Record<string, HeatmapCellValue>>>>
>;
type HeatmapResponse = {
  quarters: string[];
  default_quarter: string | null;
  cohort_config: ApiCohortConfig[];
  snapshots: Snapshots;
  generated_at: string;
  valid_person_count: number;
};

const LEVELS = [
  { min: 0, max: 0, label: "暂无覆盖", className: "level-0" },
  { min: 1, max: 2, label: "初步覆盖", className: "level-1" },
  { min: 3, max: 4, label: "中等覆盖", className: "level-2" },
  { min: 5, max: 6, label: "较高覆盖", className: "level-3" },
  { min: 7, max: Infinity, label: "高覆盖", className: "level-4" },
] as const;

function levelFor(count: number) {
  return (
    LEVELS.find((level) => count >= level.min && count <= level.max) ??
    LEVELS[4]
  );
}

function normalizeClassCount(value: unknown) {
  const count = Number(value);
  return Number.isFinite(count) ? Math.max(0, Math.round(count)) : 0;
}

function normalizeCohortConfig(config: ApiCohortConfig[]): CohortRow[] {
  return config
    .map((item) => {
      const year = Number(item.year);
      return {
        id: `cohort-${item.year}`,
        year,
        gaoxin: normalizeClassCount(item.campus_class_counts?.高新),
        linyin: normalizeClassCount(item.campus_class_counts?.林荫),
      };
    })
    .filter((item) => Number.isInteger(item.year) && item.year > 1900)
    .sort((a, b) => a.year - b.year);
}

function HeatCell({
  year,
  campus,
  classNumber,
  count,
  titles,
}: {
  year: number;
  campus: Campus;
  classNumber: number;
  count: number;
  titles: string[];
}) {
  const level = levelFor(count);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          className={`heat-cell ${level.className}`}
          aria-label={`${campus}校区 ${year}届 ${classNumber}班，${count}位重要联络人`}
        >
          {count > 0 ? count : null}
        </button>
      </TooltipTrigger>
      <TooltipContent sideOffset={8} className="tooltip-card">
        <p className="tooltip-title">
          {campus}校区 · {year}届 · {classNumber}班
        </p>
        {titles.length ? (
          <ul className="tooltip-title-list">
            {titles.map((title, index) => (
              <li key={`${title}-${index}`}>{title}</li>
            ))}
          </ul>
        ) : (
          <p className="tooltip-empty-title">暂无当前title信息</p>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

export default function Home() {
  const [quarters, setQuarters] = useState<string[]>([]);
  const [quarterIndex, setQuarterIndex] = useState(0);
  const [cohorts, setCohorts] = useState<CohortRow[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshots>({});
  const [dataState, setDataState] = useState<"loading" | "live" | "error">(
    "loading",
  );

  useEffect(() => {
    const controller = new AbortController();

    async function loadHeatmap() {
      try {
        setDataState("loading");
        const response = await fetch(HEATMAP_API, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);

        const data = (await response.json()) as HeatmapResponse;
        if (
          !Array.isArray(data.quarters) ||
          !Array.isArray(data.cohort_config) ||
          !data.snapshots
        ) {
          throw new Error("Invalid heatmap response");
        }

        setQuarters(data.quarters);
        setCohorts(normalizeCohortConfig(data.cohort_config));
        setSnapshots(data.snapshots);

        const defaultIndex = data.default_quarter
          ? data.quarters.indexOf(data.default_quarter)
          : -1;
        setQuarterIndex(
          defaultIndex >= 0
            ? defaultIndex
            : Math.max(0, data.quarters.length - 1),
        );
        setDataState("live");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setDataState("error");
      }
    }

    loadHeatmap();
    return () => controller.abort();
  }, []);

  const maxClassCount = Math.max(
    1,
    ...cohorts.flatMap((row) => [row.gaoxin, row.linyin]),
  );
  const leftSlots = Array.from(
    { length: maxClassCount },
    (_, index) => maxClassCount - index,
  );
  const rightSlots = Array.from(
    { length: maxClassCount },
    (_, index) => index + 1,
  );
  const selectedQuarter = quarters[quarterIndex] ?? "—";

  const cellData = (
    year: number,
    campus: Campus,
    classNumber: number,
  ): { count: number; titles: string[] } => {
    const value = snapshots[selectedQuarter]?.[String(year)]?.[campus]?.[
      String(classNumber)
    ];

    // Keep compatibility with the previous count-only FC response while the
    // backend is being updated.
    if (typeof value === "number") {
      return { count: value, titles: [] };
    }

    return {
      count: normalizeClassCount(value?.count),
      titles: Array.isArray(value?.titles)
        ? value.titles.filter(
            (title): title is string =>
              typeof title === "string" && title.trim().length > 0,
          )
        : [],
    };
  };

  const stats = useMemo(() => {
    let contacts = 0;
    let covered = 0;
    let total = 0;

    for (const row of cohorts) {
      for (const [campus, count] of [
        ["高新", row.gaoxin],
        ["林荫", row.linyin],
      ] as [Campus, number][]) {
        for (let classNumber = 1; classNumber <= count; classNumber += 1) {
          const value = cellData(row.year, campus, classNumber).count;
          contacts += value;
          total += 1;
          if (value > 0) covered += 1;
        }
      }
    }

    return {
      contacts,
      covered,
      rate: total ? Math.round((covered / total) * 100) : 0,
    };
  }, [cohorts, selectedQuarter, snapshots]);

  return (
    <TooltipProvider delayDuration={80}>
      <main className="app-shell">
        <header className="topbar">
          <div className="brand-lockup">
            <div className="brand-mark" aria-hidden="true">
              <span>7</span>
              <i />
            </div>
            <div>
              <p className="eyebrow">SEVENX NETWORK INTELLIGENCE</p>
              <h1>成都七中校友联络热力图</h1>
            </div>
          </div>
          <div className="topbar-actions">
            <div
              className={`data-status data-status-${dataState}`}
              aria-live="polite"
            >
              <span className="status-dot" />
              <span>
                {dataState === "live"
                  ? "飞书实时数据"
                  : dataState === "loading"
                    ? "正在同步"
                    : "连接失败"}
              </span>
              <span className="divider" />
              <Database size={14} />
              <span>飞书届别配置</span>
            </div>
          </div>
        </header>

        <section className="summary-row" aria-label="当前季度概览">
          <div className="quarter-heading">
            <p>当前视图</p>
            <div>
              <strong>{selectedQuarter}</strong>
              <span>累计覆盖</span>
            </div>
          </div>
          <div className="summary-stat">
            <UsersRound size={18} />
            <div>
              <span>重要联络人</span>
              <strong>{stats.contacts}</strong>
            </div>
          </div>
          <div className="summary-stat">
            <div
              className="mini-ring"
              style={{ "--pct": stats.rate } as React.CSSProperties}
            >
              <span>{stats.rate}</span>
            </div>
            <div>
              <span>班级覆盖率</span>
              <strong>{stats.rate}%</strong>
            </div>
          </div>
          <div className="summary-stat">
            <RefreshCw size={17} />
            <div>
              <span>已覆盖班级</span>
              <strong>{stats.covered}</strong>
            </div>
          </div>
          <div className="legend" aria-label="热力等级图例">
            {LEVELS.map((level) => (
              <div key={level.label} className="legend-item">
                <i className={level.className} />
                <span>
                  {level.max === Infinity
                    ? "7+"
                    : level.min === level.max
                      ? "0"
                      : `${level.min}–${level.max}`}
                </span>
              </div>
            ))}
            <small>联络人数</small>
          </div>
        </section>

        <section className="heatmap-card">
          <div className="heatmap-scroll">
            <div
              className="heatmap-grid"
              style={
                {
                  minWidth: `${maxClassCount * 66 + 170}px`,
                  "--class-count": maxClassCount,
                } as React.CSSProperties
              }
            >
              <div className="campus-heading campus-heading-left">
                <span>GAOXIN CAMPUS</span>
                <strong>高新校区</strong>
                <em>班级号由外向内递减</em>
              </div>
              <div className="year-heading">
                <span>届别</span>
              </div>
              <div className="campus-heading campus-heading-right">
                <strong>林荫校区</strong>
                <span>LINYIN CAMPUS</span>
                <em>班级号由内向外递增</em>
              </div>

              {cohorts.length ? (
                cohorts.map((row) => (
                  <div className="cohort-row contents" key={row.id}>
                    <div className="class-grid class-grid-left">
                      {leftSlots.map((classNumber) =>
                        classNumber <= row.gaoxin ? (
                          <HeatCell
                            key={classNumber}
                            year={row.year}
                            campus="高新"
                            classNumber={classNumber}
                            {...cellData(row.year, "高新", classNumber)}
                          />
                        ) : (
                          <span className="cell-spacer" key={classNumber} />
                        ),
                      )}
                    </div>
                    <div className="year-cell">
                      <span>{row.year}</span>
                      <small>届</small>
                    </div>
                    <div className="class-grid class-grid-right">
                      {rightSlots.map((classNumber) =>
                        classNumber <= row.linyin ? (
                          <HeatCell
                            key={classNumber}
                            year={row.year}
                            campus="林荫"
                            classNumber={classNumber}
                            {...cellData(row.year, "林荫", classNumber)}
                          />
                        ) : (
                          <span className="cell-spacer" key={classNumber} />
                        ),
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <div className="empty-config">
                  {dataState === "error"
                    ? "数据连接失败，请检查 FC 接口"
                    : dataState === "loading"
                      ? "正在读取飞书届别配置…"
                      : "飞书届别配置表暂无可展示记录"}
                </div>
              )}

              {cohorts.length > 0 && (
                <>
                  <div className="class-grid class-grid-left class-axis">
                    {leftSlots.map((classNumber) => (
                      <span key={classNumber}>{classNumber}</span>
                    ))}
                  </div>
                  <div className="axis-title">班级</div>
                  <div className="class-grid class-grid-right class-axis">
                    {rightSlots.map((classNumber) => (
                      <span key={classNumber}>{classNumber}</span>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </section>

        <section className="timeline-card" aria-label="季度时间轴">
          <div className="timeline-copy">
            <p>NETWORK GROWTH</p>
            <h2>季度演进</h2>
            <span>拖动或点击节点，查看校友网络的累计生长</span>
          </div>
          <div className="timeline-control">
            {quarters.length ? (
              <>
                <Slider
                  min={0}
                  max={Math.max(0, quarters.length - 1)}
                  step={1}
                  value={[quarterIndex]}
                  onValueChange={(value) => setQuarterIndex(value[0])}
                  aria-label="选择季度"
                  className="quarter-slider"
                />
                <div className="quarter-labels">
                  {quarters.map((quarter, index) => (
                    <button
                      key={quarter}
                      className={
                        index === quarterIndex
                          ? "active"
                          : index < quarterIndex
                            ? "past"
                            : ""
                      }
                      onClick={() => setQuarterIndex(index)}
                    >
                      <i />
                      <span>{quarter}</span>
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <span className="timeline-empty">
                {dataState === "error"
                  ? "飞书数据连接失败"
                  : "正在读取季度数据…"}
              </span>
            )}
          </div>
          <div className="timeline-current">
            <span>显示截至</span>
            <strong>{selectedQuarter}</strong>
          </div>
        </section>
      </main>
    </TooltipProvider>
  );
}
