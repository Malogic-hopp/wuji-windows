# Tauri 2 + React 19 阶段 8A 完成说明（活动分析迁移与 parity）

日期：2026-07-19

状态：已完成；活动分析四个只读方法已端到端打通（Application 语义 → 合同 → Bridge → Rust command → React 页面），WPF↔Tauri parity 工具与 smoke 全部通过

实施分支：`codex/application-client-sdk`

## 1. 本阶段范围

阶段 8A 实施阶段 8“后续页面迁移”的第一个切片：活动分析（今日 / 趋势 / 时间线 / 热力图）。按阶段 8 既定闭环推进：

```text
contract → Bridge mapper → Rust command → React query/UI → parity → accessibility → privacy → docs
```

子阶段划分：F1 Application 语义收口、F2 合同与 Bridge、F3～F5 React 四个页面、F6 parity 工具与 smoke。本阶段：

- 不修改 IPC、SQLite、Agent 状态机或数据格式；
- 不改变 WPF 默认启动路径，不访问或修改 prod channel；
- 四个方法全部只读，不引入任何副作用入口；
- React 仍不能传入 method、路径、channel 或查询 SQL。

## 2. F1：Application 语义收口

目标是把活动分析的展示语义全部沉到 Application/Core，让 WPF 与 Bridge 消费同一份结果，前端只做呈现：

- 新增 `TimelineDataService`（`ITimelineDataService`）：按本地日输出 clipped segments 与预计算 gaps。会话裁剪到本地日边界、按开始时间升序；未关闭会话今天的有效结束为 `TimeProvider` now，过去日期裁剪到日终；时长复用与 `DailyStatsService` 一致的 overlap 比例缩放与 AwayFromZero 取整；gaps 只存在于相邻段之间，不在日首/日尾捏造。
- `TimelineResult`/`TimelineSegment`/`TimelineGap` 放入 `Application/Contracts/Activity`，框架无关，刻意不携带窗口标题、可执行路径或会话 id。
- 热力图五级强度下沉：`DailyHourActivityPoint` 新增 `IntensityLevel`，由 `HourActivityHeatmapCalculator` 按共享阈值（0、0.25、0.5、0.75）统一分桶；WPF `HourActivityHeatmapViewModel` 改为直接消费该级别，不再各自推导颜色档。
- `IActivityClient` 新增 `DailyStats`/`WeeklyTrend`/`Heatmap`/`Timeline` 访问器，`WujiClientFactory` 统一装配。

F1 回归：`TimelineDataServiceTests` 6 项（升序、跨午夜裁剪、未关闭会话 now 语义、过去日期日终裁剪、空档规则、空日）与 `ApplicationUseCaseTests` 4 项（热力图 168 矩阵、五级分桶阈值等）全部通过。

## 3. F2：合同、Bridge 与 Rust command

合同新增四个只读白名单方法并重新生成三端类型：

| 方法 | `IWujiClient` 用例 | 副作用 | timeout |
|---|---|---:|---:|
| `activity.getDailyStats` | `Activity.DailyStats.GetSummaryForDateAsync` | 否 | 10 秒 |
| `activity.getWeeklyTrend` | `Activity.WeeklyTrend.GetWeeklyTrendAsync` | 否 | 10 秒 |
| `activity.getTimeline` | `Activity.Timeline.GetTimelineAsync` | 否 | 10 秒 |
| `activity.getHeatmap` | `Activity.Heatmap.GetHeatmapAsync` | 否 | 10 秒 |

要点：

- `getDailyStats`/`getTimeline` 参数固定为 `{ date: yyyy-MM-dd }` 本地日期，`BridgeHost` 严格 `TryParseExact` 校验，非法参数返回安全 `invalid_request`；
- `BridgeActivityMapper` 只输出安全 DTO：日期字符串、计数、取整时长、`isToday`、五级强度、snake_case `closeReason` 枚举；`unknownSeconds` 由 `total-active-idle` 不变量推导；`appName`/`topAppName` 复用显示名消毒（去目录、去控制字符、限长 128，空值回退“未知应用”）；
- 三段中文比较文案（对 7 天均值、对昨天、本周迄今）由 Application 生成，Bridge 原样透传，前端不重写；
- Rust 增加 `activity_get_daily_stats`/`activity_get_weekly_trend`/`activity_get_timeline`/`activity_get_heatmap` 四个语义 command，React 白名单同名，command 只执行固定 `supervisor.request(...)`，不累加、不排序、不推导状态；
- query key 固定为 `['activity', 'daily-stats'| 'weekly-trend' | 'timeline' | 'heatmap']`，Bridge `ready`/手动重连统一失效整个 `['activity']` 域。

F2 回归：合同漂移检查、Bridge 宿主/合同测试（含日期参数校验、四个方法的映射与隐私形状）全部通过。

## 4. F3～F5：React 活动分析页面

新增四个路由页面与对应 feature 视图：

- `ActivityTodayPage` + `ActivityTodayView`：今日总时长/有效/空闲/会话数与 24 小时分桶；
- `ActivityTrendPage`：近 7 日逐日有效时长、7 天均值与三段中文比较文案；
- `ActivityTimelinePage` + `TimelineView`：今日会话段与空档时间线，未关闭段明确标识；
- `ActivityHeatmapPage` + `HeatmapView`：7×24 热力图，直接渲染合同 `intensityLevel` 五级色阶。

统一约束：

- 页面状态固定为 `Loading | Empty | Ready | Error`，Empty 由 `activityModel` 的全零判定决定，Error 提供安全中文说明与重试；
- 数值的时/分/秒拆分、UTC→本地转换、百分比与日期格式只发生在 locale-aware 显示层（`activityFormatting`），不改业务数值；
- 热力图每格可聚焦、带自动化名称与 tooltip，支持方向键移动与 Enter/Space 联动到对应时间线日期/小时；五级图例常显，High Contrast 保留单元格边界；
- 原生 button、全局 focus-visible、forced-colors 与 prefers-reduced-motion 规则覆盖键盘、High Contrast 与减少动画要求。

F3～F5 回归：React 19 个测试文件 105 项全部通过，覆盖四个页面的四态、重试、本地化格式、热力图交互与 query 失效。

## 5. F6：WPF↔Tauri parity 工具与 smoke

新增 `tools/QuantifiedSelf.Windows.ActivityParity`（net8.0 控制台，已加入解决方案 tools 文件夹），CLI 与 dashboard-parity 对齐：

```text
activity-parity --bridge <path-to-bridge-exe> [--report <path>]
```

行为：

- dev Agent 运行中直接拒绝（exit 3），不结束任何进程；
- WPF 路径：`WujiClientFactory` dev-channel client，依次调用 `DailyStats.GetSummaryForDateAsync(today)`、`WeeklyTrend.GetWeeklyTrendAsync()`、`Timeline.GetTimelineAsync(today)`、`Heatmap.GetHeatmapAsync()`；
- Bridge 路径：以 `--channel dev` 启动固定 Bridge，`bridge.hello`（能力校验包含四个新方法）→ `client.initialize` → 四个新方法 → `bridge.shutdown`；
- 逐字段比对：今日统计总量与 24 小时分桶、趋势 7 天逐日数值/均值/三段中文文案逐字、时间线会话段与空档（含 `appName`、`closeReason`、UTC 时间）、热力图 168 单元格与 `today` 标记；
- 每个 Bridge 响应递归执行隐私 allowlist：禁止 id/processName/windowTitle/executablePath/databasePath/dataRoot/pipeName/exception/stackTrace 成员名与路径形态字符串（`closeReason` 为合同批准的安全枚举，显式放行）；
- Markdown 报告默认写入 `%TEMP%\WUJI.Smoke\`，只含聚合数字与验收结论，无用户名、绝对路径或原始标题；
- 退出码与 DashboardParity 一致：0 全部通过 / 1 存在不一致 / 2 参数错误 / 3 dev Agent 运行中。

**浮动原点容差策略**：DashboardParity 的做法是“dev Agent 停止 ⇒ 数据静止 ⇒ 精确比对”。本工具沿用该前提，并对唯一真正随 now 浮动的场景做有界容差：当今日时间线存在未关闭会话时，其有效结束为读取时刻的 now，顺序读取之间可能漂移若干秒。工具实测两次读取之间的墙钟间隔（向上取整 +2 秒取整余量）作为容差，只施加于 now 派生字段（未关闭段的 `endedAtUtc`/四项时长、今日统计总量、趋势今日 `activeSeconds`/`focusSeconds` 与均值、以未关闭段为前驱的空档起点与时长）；计数、日期、标记、样本派生的小时分桶与全部 168 单元格始终精确比对。无未关闭会话时容差为 0，全量精确比对。

新增 `pnpm smoke:activity-parity`（`scripts/activity-parity-smoke.ps1`），步骤与 dashboard-parity smoke 对齐：bridge:prepare → React build → bundle budget → Vitest → WPF Application 语义测试 → parity 工具 → 报告追加 UI/预算验收段。

同时新增两项 `TauriArchitectureBoundaryTests` 门禁，与 Dashboard/Settings parity 门禁同级：一项冻结 `smoke:activity-parity` 入口、脚本内固定 dev Bridge 路径与 prod 禁用；一项冻结 probe 的 dev channel、dev Agent 运行拒绝、四个方法名与隐私字段检查。

## 6. 自动验证

```text
Bridge contract drift                     PASS（F2 阶段执行）
React tests                               105/105（19 个测试文件）
Production build + bundle budget          PASS（主 bundle 325.87 KiB raw / 101.38 KiB gzip）
WPF Application 语义测试                  10/10（Timeline 6 + Heatmap/Trend 4）
Activity parity 验收项                    18/18 PASS
```

真实 dev parity 摘要（dev Agent 停止，顺序读取同一数据库）：

| 指标 | WPF | Tauri |
|---|---:|---:|
| 今日总时长（秒） | 33809 | 33809 |
| 今日有效时长（秒） | 1748 | 1748 |
| 今日会话数 | 20 | 20 |
| 今日样本数 | 11274 | 11274 |
| 时间线会话段数 / 空档数 | 20 / 7 | 20 / 7 |
| 热力图单元格数 | 168 | 168 |

本次 dev 数据库无未关闭会话，容差标定为 0，全部数值精确一致；四个响应的隐私 allowlist 全部通过。报告见 `%TEMP%\WUJI.Smoke\activity-parity-20260719-155721.md`。

最终验证（F6 收口时执行）：

```text
dotnet build QuantifiedSelf.Windows.sln   0 警告 / 0 错误
Client.Bridge.Tests                        58/58
主测试项目 Category=Fast                   121/121
pnpm test（Vitest）                        105/105
contracts:check                            PASS（无漂移）
```

F6 同时修正了一处过期架构门禁：`BridgeReady_InvalidatesTheDashboardOverviewQuery` 仍断言只失效 `activityOverviewQueryKey`，而 F3～F5 已把 Bridge ready 后的失效扩大到整个 `['activity']` 域（overview 包含在内）；门禁已更新为冻结新的域级失效约定，功能代码未改动。

## 7. 已知边界与下一步

- parity 目前覆盖“今天”视角；过去日期的 `getDailyStats`/`getTimeline` 由同一 Application 路径服务，合同与映射已被单测冻结，必要时可在 parity 工具中增加指定日期参数比对；
- 趋势三段文案在数据跨边界时刻存在理论上的瞬时翻转窗口，parity 逐字比对若遇此类失败应先复核数据再判定；
- 阶段 7B（dev-preview installer 与安全基线）按规划继续；阶段 8 其余页面（Diagnostics、Apps、Privacy、Insights 等）沿用本切片验证过的闭环推进。
