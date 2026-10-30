import { useState } from 'react';
import type { Task, TaskStatus } from '@nova/shared';
import { Check, CircleDashed, Loader2, OctagonX, Plus } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/cn';
import { useCodeStore } from '@/store/code';
import { api } from '@/lib/api';
import { Badge, Button, EmptyState, TextInput } from '@/components/ui';

const ORDER: TaskStatus[] = ['in_progress', 'pending', 'done', 'blocked', 'cancelled'];

const TONE: Record<TaskStatus, 'info' | 'neutral' | 'success' | 'danger' | 'warning'> = {
  pending: 'neutral',
  in_progress: 'info',
  done: 'success',
  blocked: 'warning',
  cancelled: 'danger',
};

export function TasksPanel() {
  const { t } = useI18n();
  const tasks = useCodeStore((s) => s.tasks);
  const patchTask = useCodeStore((s) => s.patchTask);
  const activeProjectId = useCodeStore((s) => s.activeProjectId);
  const loadTasks = useCodeStore((s) => s.loadTasks);

  const [title, setTitle] = useState('');
  const [adding, setAdding] = useState(false);

  const sorted = [...tasks].sort(
    (a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status) || a.order - b.order || a.createdAt.localeCompare(b.createdAt),
  );

  const cycle = (task: Task) => {
    const next: TaskStatus = task.status === 'pending' ? 'in_progress' : task.status === 'in_progress' ? 'done' : 'pending';
    void patchTask(task.id, { status: next });
  };

  const add = async () => {
    if (!title.trim() || !activeProjectId) return;
    setAdding(true);
    try {
      await api.createTask({ projectId: activeProjectId, title: title.trim(), status: 'pending' });
      setTitle('');
      await loadTasks();
    } finally {
      setAdding(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 border-b border-line p-2.5">
        <TextInput
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void add()}
          placeholder={t('tasks.decompose')}
          className="!py-1.5 !text-[12px]"
        />
        <Button size="sm" variant="outline" icon={<Plus size={12} />} loading={adding} disabled={!title.trim()} onClick={() => void add()}>
          {t('code.create')}
        </Button>
      </div>

      <div className="scroll-thin min-h-0 flex-1">
        {sorted.length === 0 ? (
          <EmptyState icon={<CircleDashed size={20} />} title={t('tasks.empty')} />
        ) : (
          <ul className="flex flex-col gap-1 p-2">
            {sorted.map((task) => (
              <li key={task.id} className="rounded-lg border border-line bg-surface p-2">
                <div className="flex items-start gap-2">
                  <button
                    type="button"
                    onClick={() => cycle(task)}
                    title={t(`tasks.${task.status === 'in_progress' ? 'in-progress' : task.status}` as never)}
                    className="mt-0.5 shrink-0 text-muted transition-colors hover:text-accent"
                  >
                    {task.status === 'done' ? (
                      <Check size={14} className="text-success" />
                    ) : task.status === 'in_progress' ? (
                      <Loader2 size={14} className="animate-spin text-info" />
                    ) : task.status === 'blocked' ? (
                      <OctagonX size={14} className="text-warning" />
                    ) : (
                      <CircleDashed size={14} className="text-dim" />
                    )}
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className={cn('text-[12.5px] leading-snug', task.status === 'done' ? 'text-dim line-through' : 'text-text')}>
                      {task.title}
                    </p>
                    {task.detail ? (
                      <p className="mt-0.5 whitespace-pre-wrap text-[11px] leading-snug text-dim">{task.detail}</p>
                    ) : null}
                  </div>
                  <Badge tone={TONE[task.status]}>
                    {t(`tasks.${task.status === 'in_progress' ? 'in-progress' : task.status}` as never)}
                  </Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
