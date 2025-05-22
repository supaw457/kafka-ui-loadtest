#!/bin/bash

echo "🛑 Stopping Kafka..."

# หาค่า PID และหยุด
PID=$(ps aux | grep kafka.Kafka | grep -v grep | awk '{print $2}')
if [ -n "$PID" ]; then
  kill -15 $PID
  echo "✔️ Sent SIGTERM to Kafka (PID $PID)"
else
  echo "⚠️ Kafka is not running"
fi