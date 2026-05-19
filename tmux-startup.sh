#!/bin/bash
# Idempotent — safe to call multiple times
tmux has-session -t dev 2>/dev/null && exit 0

tmux new-session -d -s dev -n fcc-server
tmux send-keys -t dev:fcc-server 'fcc-server' Enter

tmux new-window -t dev -n slay -c ~/projects/slay
tmux send-keys -t dev:slay 'npm run dev' Enter
