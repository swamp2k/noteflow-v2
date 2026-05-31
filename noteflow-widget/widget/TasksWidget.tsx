import React from 'react';
import {
  FlexWidget,
  ListWidget,
  TextWidget,
} from 'react-native-android-widget';
import { colors } from '../constants/theme';
import type { Task } from './tasksBridge';
import { formatDue, isOverdue, priorityDot } from './tasksBridge';

interface Props {
  tasks: Task[];
  url: string;
}

export function TasksWidget({ tasks, url }: Props) {
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
          padding: 12,
          backgroundColor: colors.bg,
        }}
      >
        <FlexWidget style={{ flex: 1 }}>
          <TextWidget
            text="✓ NoteFlow Tasks"
            style={{ color: colors.text, fontSize: 15, fontWeight: 'bold' }}
          />
        </FlexWidget>
        <TextWidget
          text="↺"
          clickAction="WIDGET_REFRESH"
          style={{ color: colors.muted, fontSize: 18, padding: 4 }}
        />
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
            style={{ color: colors.muted, fontSize: 14 }}
          />
        </FlexWidget>
      ) : (
        <ListWidget>
          {tasks.map((task) => {
            const overdue = isOverdue(task.due_at);
            const dueLabel = formatDue(task.due_at);
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
                <TextWidget
                  text={priorityDot(task.priority)}
                  style={{ fontSize: 13, marginRight: 8 }}
                />
                <FlexWidget style={{ flex: 1 }}>
                  <TextWidget
                    text={task.title}
                    style={{
                      color: overdue ? colors.overdue : colors.text,
                      fontSize: 14,
                    }}
                    maxLines={1}
                  />
                </FlexWidget>
                {dueLabel ? (
                  <TextWidget
                    text={dueLabel}
                    style={{
                      color: overdue ? colors.overdue : colors.muted,
                      fontSize: 12,
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
          style={{ color: colors.accent, fontSize: 13, padding: 4 }}
        />
        <TextWidget
          text="Open app"
          clickAction="OPEN_URI"
          clickActionData={{ uri: `${url}/#/tasks` }}
          style={{ color: colors.accent, fontSize: 13, padding: 4 }}
        />
      </FlexWidget>
    </FlexWidget>
  );
}
