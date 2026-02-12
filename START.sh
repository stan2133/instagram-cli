#!/bin/bash

echo ""
echo "🌐 启动 Instagram CLI 登录..."
echo ""

cd "$(dirname "$0")"

node bin/insta.js login

echo ""
echo "✨ 登录完成！现在你可以使用其他命令："
echo ""
echo "  node bin/insta.js whoami           # 查看当前用户"
echo "  node bin/insta.js session:list     # 列出所有 session"
echo "  node bin/insta.js --help           # 查看所有命令"
echo ""
