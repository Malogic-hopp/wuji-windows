import { describe, expect, it } from 'vitest';
import { presentAgentState } from './agentPresentation';

describe('presentAgentState', () => {
  it('将暂停状态映射为继续与停止操作', () => {
    const result = presentAgentState({ actualState: 'paused', isRunning: true, isHealthy: true });
    expect(result.label).toBe('已暂停');
    expect([...result.availableCommands]).toEqual(['resume', 'stop']);
  });

  it('过渡状态不允许重复命令', () => {
    expect(presentAgentState({ actualState: 'stopping', isRunning: true, isHealthy: true }).availableCommands.size).toBe(0);
  });

  it('冷启动可区分 running、paused、stale-running 与 not-running', () => {
    const cases = [
      ['running', true, '正在记录', ['pause', 'stop']],
      ['paused', true, '已暂停', ['resume', 'stop']],
      ['stale', true, '状态待确认', ['stop']],
      ['not_running', false, '未运行', ['start']],
    ] as const;

    for (const [state, isRunning, label, commands] of cases) {
      const presentation = presentAgentState({ actualState: state, isRunning, isHealthy: true });
      expect(presentation.label).toBe(label);
      expect([...presentation.availableCommands]).toEqual(commands);
    }
  });

  it('stale 且进程不存在时提供重新启动而不是无效停止', () => {
    const presentation = presentAgentState({
      actualState: 'stale',
      isRunning: false,
      isHealthy: true,
    });

    expect(presentation.label).toBe('记录已中断');
    expect(presentation.detail).toBe('Agent 未运行，可以重新启动');
    expect([...presentation.availableCommands]).toEqual(['start']);
  });

  it('error 且进程不存在时允许恢复启动', () => {
    const presentation = presentAgentState({
      actualState: 'error',
      isRunning: false,
      isHealthy: false,
    });

    expect([...presentation.availableCommands]).toEqual(['start']);
  });
});
