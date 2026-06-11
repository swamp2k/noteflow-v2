import React from 'react';
import {
  FlexWidget,
  ListWidget,
  TextWidget,
} from 'react-native-android-widget';
import { colors } from '../constants/theme';
import type { Task, TextSize } from './tasksBridge';
import { formatDue, isOverdue } from './tasksBridge';

interface Props {
  tasks: Task[];
  url: string;
  textSize?: TextSize;
}

const FONT_SIZES: Record<TextSize, { header: number; title: number; due: number; footer: number; empty: number }> = {
  small:  { header: 13, title: 12, due: 10, footer: 11, empty: 12 },
  medium: { header: 15, title: 14, due: 12, footer: 13, empty: 14 },
  large:  { header: 17, title: 17, due: 14, footer: 15, empty: 16 },
};

// Deterministic color from subject name — matches the PWA's SUBJECT_PALETTE hash
const SUBJECT_PALETTE = ['#7c6fa0', '#4a9eda', '#e67e22', '#27ae60', '#e74c3c', '#8e44ad', '#16a085'] as const;
function subjectColor(subject: string): `#${string}` {
  let hash = 0;
  for (let i = 0; i < subject.length; i++) hash = ((hash * 31) + subject.charCodeAt(i)) >>> 0;
  return SUBJECT_PALETTE[hash % SUBJECT_PALETTE.length];
}

export function TasksWidget({ tasks, url, textSize = 'medium' }: Props) {
  const fs = FONT_SIZES[textSize] ?? FONT_SIZES.medium;

  return (
    <FlexWidget
      style={{
        height: 'match_parent',
        width: 'match_parent',
        flexDirection: 'column',
        backgroundColor: colors.surface,
      }}
    >
      {/* Header */}
      <FlexWidget
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingHorizontal: 12,
          paddingVertical: 10,
          backgroundColor: colors.bg,
        }}
      >
        <FlexWidget style={{ flex: 1 }}>
          <TextWidget
            text="✓ NoteFlow Tasks"
            style={{ color: colors.text, fontSize: fs.header, fontWeight: 'bold' }}
          />
        </FlexWidget>
        {/* Refresh — FlexWidget gives a proper 44dp touch target; works when
            battery optimisation is disabled for this app (Settings → Apps →
            NoteFlow Widget → Battery → Unrestricted). */}
        <FlexWidget
          clickAction="WIDGET_REFRESH"
          style={{
            width: 44,
            height: 44,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <TextWidget
            text="↺"
            style={{ color: colors.muted, fontSize: 18 }}
          />
        </FlexWidget>
      </FlexWidget>

      {/* Divider */}
      <FlexWidget style={{ height: 1, backgroundColor: colors.border }} />

      {/* Task list */}
      {tasks.length === 0 ? (
        <FlexWidget
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 }}
        >
          <TextWidget
            text="No pending tasks"
            style={{ color: colors.muted, fontSize: fs.empty }}
          />
        </FlexWidget>
      ) : (
        <ListWidget>
          {tasks.map((task) => {
            const overdue = isOverdue(task.due);
            const dueLabel = formatDue(task.due);
            const dotColor = task.subject ? subjectColor(task.subject) : colors.border;
            return (
              <FlexWidget
                key={task.id}
                clickAction="OPEN_URI"
                clickActionData={{ uri: `${url}/#/task/${task.id}` }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  backgroundColor: colors.surface,
                }}
              >
                {/* Subject dot */}
                <FlexWidget
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: dotColor,
                    marginRight: 10,
                  }}
                />
                <FlexWidget style={{ flex: 1 }}>
                  <TextWidget
                    text={task.title}
                    style={{
                      color: overdue ? colors.overdue : colors.text,
                      fontSize: fs.title,
                    }}
                    maxLines={1}
                  />
                </FlexWidget>
                {dueLabel ? (
                  <TextWidget
                    text={dueLabel}
                    style={{
                      color: overdue ? colors.overdue : colors.muted,
                      fontSize: fs.due,
                      marginLeft: 8,
                    }}
                  />
                ) : null}
              </FlexWidget>
            );
          })}
        </ListWidget>
      )}

      {/* Divider */}
      <FlexWidget style={{ height: 1, backgroundColor: colors.border }} />

      {/* Footer */}
      <FlexWidget
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          backgroundColor: colors.bg,
          paddingHorizontal: 12,
          paddingVertical: 8,
        }}
      >
        <TextWidget
          text="+ New"
          clickAction="OPEN_URI"
          clickActionData={{ uri: `${url}/#/new-task` }}
          style={{ color: colors.accent, fontSize: fs.footer, padding: 4 }}
        />
        <TextWidget
          text="Open app"
          clickAction="OPEN_URI"
          clickActionData={{ uri: `${url}/#/tasks` }}
          style={{ color: colors.accent, fontSize: fs.footer, padding: 4 }}
        />
      </FlexWidget>
    </FlexWidget>
  );
}
