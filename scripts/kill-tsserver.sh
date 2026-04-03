#!/usr/bin/env bash
# Kill tsserver processes belonging to the current Claude Code session only.
# Walks up from $$ to find the ancestor `claude` PID, then kills only
# tsserver.js processes that are descendants of that PID.

claude_pid=$$
while [ "$(ps -p "$claude_pid" -o comm= 2>/dev/null)" != "claude" ]; do
  claude_pid=$(ps -p "$claude_pid" -o ppid= 2>/dev/null | tr -d ' ')
  if [ "$claude_pid" = "1" ] || [ -z "$claude_pid" ]; then
    echo "No claude ancestor found"
    exit 0
  fi
done

killed=0
for tspid in $(pgrep -f tsserver.js); do
  p=$tspid
  while [ "$p" != "1" ] && [ "$p" != "$claude_pid" ] && [ -n "$p" ]; do
    p=$(ps -p "$p" -o ppid= 2>/dev/null | tr -d ' ')
  done
  if [ "$p" = "$claude_pid" ]; then
    kill "$tspid"
    echo "Killed tsserver PID $tspid"
    killed=$((killed + 1))
  fi
done

if [ "$killed" -eq 0 ]; then
  echo "No tsserver processes found for this session"
else
  echo "Restarted $killed tsserver process(es)"
fi
