#!/usr/bin/env bash
input=$(cat)

# Extract context window fields
used_pct=$(echo "$input" | jq -r '.context_window.used_percentage // empty')
total_input=$(echo "$input" | jq -r '.context_window.total_input_tokens // 0')
total_output=$(echo "$input" | jq -r '.context_window.total_output_tokens // 0')
model_id=$(echo "$input" | jq -r '.model.id // ""')

# Determine pricing per million tokens based on model
# Default: claude-sonnet-4 pricing ($3/M input, $15/M output)
input_price="3"
output_price="15"

if echo "$model_id" | grep -qi "haiku"; then
  input_price="0.8"
  output_price="4"
elif echo "$model_id" | grep -qi "opus"; then
  input_price="15"
  output_price="75"
fi

# Calculate estimated cost
cost=$(echo "scale=4; ($total_input * $input_price / 1000000) + ($total_output * $output_price / 1000000)" | bc 2>/dev/null)

parts=""

# Git branch (using cwd from input to target the correct repo)
cwd=$(echo "$input" | jq -r '.cwd // empty')
if [ -n "$cwd" ]; then
  git_branch=$(git -C "$cwd" symbolic-ref --short HEAD 2>/dev/null)
  if [ -n "$git_branch" ]; then
    branch_str="$(printf "\033[34mbranch: ${git_branch}\033[0m")"
    parts="${branch_str}"
  fi
fi

# Context usage
if [ -n "$used_pct" ]; then
  used_int=$(printf "%.0f" "$used_pct")
  if [ "$used_int" -ge 40 ]; then
    # Bold + blink + red as a reminder to run /compact
    ctx_str="$(printf "\033[1;5;31mctx: ${used_int}%% /compact!\033[0m")"
  else
    ctx_str="$(printf "\033[32mctx: ${used_int}%%\033[0m")"
  fi
  [ -n "$parts" ] && parts="${parts}  ${ctx_str}" || parts="${ctx_str}"
fi

# Token counts
if [ "$total_input" -gt 0 ] || [ "$total_output" -gt 0 ]; then
  in_k=$(echo "scale=1; $total_input / 1000" | bc 2>/dev/null)
  out_k=$(echo "scale=1; $total_output / 1000" | bc 2>/dev/null)
  tok_str="$(printf "\033[36min: ${in_k}k out: ${out_k}k\033[0m")"
  [ -n "$parts" ] && parts="${parts}  ${tok_str}" || parts="${tok_str}"
fi

# Estimated cost
if [ -n "$cost" ] && [ "$(echo "$cost > 0" | bc 2>/dev/null)" = "1" ]; then
  cost_fmt=$(printf "\$%.4f" "$cost")
  cost_str="$(printf "\033[35m~${cost_fmt}\033[0m")"
  [ -n "$parts" ] && parts="${parts}  ${cost_str}" || parts="${cost_str}"
fi

[ -n "$parts" ] && printf "%b" "$parts"
