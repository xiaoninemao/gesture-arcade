# Gesture Arcade for macOS

使用 Mac 摄像头和 MediaPipe Hand Landmarker 的多游戏手势游戏厅。

## 运行

在 Finder 中双击 `Start Gesture Arcade.command`，或者在终端运行：

```bash
npm start
```

使用 Safari 或 Chrome 访问 `http://localhost:4173`，点击“连接摄像头”，并允许摄像头权限。

包含：

- 星际穿越：移动食指驾驶飞船
- 投篮高手：瞄准篮筐并捏合投篮
- 丛林跳跃：张开手掌跳过障碍

如果摄像头打不开，请前往 macOS“系统设置 → 隐私与安全性 → 摄像头”，允许当前浏览器访问。

## 构建 macOS App

```bash
./native/build-app.sh
```

构建结果位于 `outputs/Gesture Arcade.app`。
