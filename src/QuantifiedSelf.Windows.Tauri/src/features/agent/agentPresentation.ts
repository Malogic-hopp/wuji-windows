import type { AgentStatus } from '../../bridge/contracts';

export interface AgentPresentation {
  readonly label: string;
  readonly detail: string;
  readonly tone: 'neutral' | 'positive' | 'warning' | 'danger';
  readonly availableCommands: ReadonlySet<'start' | 'pause' | 'resume' | 'stop'>;
}

const startOnly = new Set(['start'] as const);
const pauseStop = new Set(['pause', 'stop'] as const);
const resumeStop = new Set(['resume', 'stop'] as const);
const stopOnly = new Set(['stop'] as const);
const noCommands = new Set<never>();

type PresentableAgentStatus = Pick<AgentStatus, 'actualState' | 'isRunning' | 'isHealthy'>;

export function presentAgentState(status: PresentableAgentStatus): AgentPresentation {
  const healthyDetail = status.isHealthy ? '服务响应正常' : '等待健康状态';

  switch (status.actualState) {
    case 'running':
      return { label: '正在记录', detail: healthyDetail, tone: 'positive', availableCommands: pauseStop };
    case 'paused':
      return { label: '已暂停', detail: healthyDetail, tone: 'warning', availableCommands: resumeStop };
    case 'starting':
      return { label: '正在启动', detail: '正在等待 Agent 就绪', tone: 'neutral', availableCommands: noCommands };
    case 'pausing':
      return { label: '正在暂停', detail: '正在处理控制命令', tone: 'neutral', availableCommands: noCommands };
    case 'resuming':
      return { label: '正在恢复', detail: '正在等待采样恢复', tone: 'neutral', availableCommands: noCommands };
    case 'stopping':
      return { label: '正在停止', detail: '正在等待 Agent 退出', tone: 'neutral', availableCommands: noCommands };
    case 'stale':
      return status.isRunning
        ? {
            label: '状态待确认',
            detail: 'Agent 进程仍在，但心跳已过期',
            tone: 'warning',
            availableCommands: stopOnly,
          }
        : {
            label: '记录已中断',
            detail: 'Agent 未运行，可以重新启动',
            tone: 'warning',
            availableCommands: startOnly,
          };
    case 'error':
      return status.isRunning
        ? {
            label: '服务异常',
            detail: 'Agent 仍在运行，可以停止后重试',
            tone: 'danger',
            availableCommands: stopOnly,
          }
        : {
            label: '服务异常',
            detail: 'Agent 未运行，可以重新启动',
            tone: 'danger',
            availableCommands: startOnly,
          };
    case 'maintenance':
      return { label: '维护中', detail: '后台维护完成后会自动恢复', tone: 'warning', availableCommands: noCommands };
    case 'not_running':
    case 'stopped':
      return { label: '未运行', detail: 'Agent 尚未启动', tone: 'neutral', availableCommands: startOnly };
  }
}
