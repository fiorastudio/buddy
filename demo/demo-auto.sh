#!/usr/bin/env bash
# Auto demo — plays the hatch, observe, pet sequence with timing
cd "$(dirname "$0")/.."

clear
echo ""
sleep 0.5

echo "  🥚 Hatching a buddy..."
echo ""
sleep 1

echo '{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"demo","version":"1.0.0"}}}
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"buddy_hatch","arguments":{"name":"Nuzzlecap","species":"Mushroom","user_id":"demo-user"}}}' | timeout 10 node dist/server/index.js 2>/dev/null | tail -1 | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const r=JSON.parse(d);r.result.content.forEach(c=>console.log(c.text))}catch(e){}})"

sleep 2

echo ""
echo "  👀 Nuzzlecap watches you code..."
echo ""
sleep 1

echo '{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"demo","version":"1.0.0"}}}
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"buddy_observe","arguments":{"summary":"wrote a clean CSV parser with proper error handling","mode":"skillcoach"}}}' | timeout 10 node dist/server/index.js 2>/dev/null | tail -1 | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const r=JSON.parse(d);console.log(r.result.content[0].text)}catch(e){}})"

sleep 2

echo ""
echo "  ♥ Petting Nuzzlecap..."
echo ""
sleep 1

echo '{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"demo","version":"1.0.0"}}}
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"buddy_pet","arguments":{}}}' | timeout 10 node dist/server/index.js 2>/dev/null | tail -1 | node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const r=JSON.parse(d);r.result.content.forEach(c=>console.log(c.text))}catch(e){}})"

sleep 2
echo ""
echo "  🐾 Your buddy is here to stay."
echo ""
