#!/bin/bash

BASEDIR="$(cd "$(dirname "$0")" && pwd)"
KAFKA_DIR="$BASEDIR/kafka/kafka_2.13-4.0.0"
KAFKA_CONFIG="$KAFKA_DIR/kraft-server.properties"
KAFKA_STORAGE_DIR="$BASEDIR/kafka-logs"
LOG_DIR="$BASEDIR/logs"

if [ ! -f "$KAFKA_DIR/bin/kafka-server-start.sh" ]; then
  echo "❌ Kafka start script not found"
  exit 1
fi

if [ ! -f "$KAFKA_CONFIG" ]; then
  echo "❌ Kafka config not found"
  exit 1
fi

mkdir -p "$LOG_DIR"

# Format Kafka log dir if needed
if [ ! -f "$KAFKA_STORAGE_DIR/meta.properties" ]; then
  echo "🔧 Formatting Kafka storage directory..."

  CLUSTER_ID=$("$KAFKA_DIR/bin/kafka-storage.sh" random-uuid)
  "$KAFKA_DIR/bin/kafka-storage.sh" format \
    --config "$KAFKA_CONFIG" \
    --cluster-id "$CLUSTER_ID"

  echo "✅ Kafka storage formatted"
fi

echo "🧠 Starting Kafka..."
"$KAFKA_DIR/bin/kafka-server-start.sh" "$KAFKA_CONFIG" > "$LOG_DIR/kafka.log" 2>&1 &
KAFKA_PID=$!

echo "⌛ Waiting for Kafka port 9092 to be available..."
while ! nc -z localhost 9092; do   
  sleep 1
done

echo "🚀 Starting app..."
cd "$BASEDIR"
exec npx nodemon app.js

# Optional: Kill Kafka on exit
# trap "echo '🛑 Stopping Kafka...'; kill $KAFKA_PID" EXIT