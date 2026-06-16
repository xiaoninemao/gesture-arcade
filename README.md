# Gesture Arcade for macOS

Gesture Arcade 是一个基于 Mac 摄像头和 MediaPipe 手势识别的体感小游戏合集。玩家不需要手柄或键盘，只要抬起手，摄像头就会把手掌、食指、捏合等动作转换成游戏控制。

![Gesture Arcade 首页](assets/readme-home.jpg)

## 特色

- 纯摄像头手势控制，无键盘输入。
- 本机处理摄像头画面，识别结果直接用于游戏控制。
- macOS 风格桌面应用外壳，内置 WKWebView。
- 首页摄像头检测，检测通过后解锁游戏。
- 成就、星光值、玩家资料和设置面板。
- 多款游戏拥有阶段难度、道具、连击和分数系统。

## 游戏列表

- **星际穿越**：移动食指驾驶飞船，在阶段时间内收集能量，避开越来越密集的红色陨石。
- **投篮高手**：移动手掌瞄准，捏合投篮；篮筐会随阶段切换静止、横移、波浪、环形和高速折返等模式。
- **丛林跳跃**：张开手掌跳跃，捏合冲刺，利用空中道具穿越丛林障碍。
- **海底吞噬**：控制小鱼吃掉更小的鱼成长，避开大鱼；无倒计时，两条命，泡泡提供短时护盾。
- **节奏守门**：根据音符提示做出张掌、握拳或捏合手势，保持舞台能量。
- **魔法守塔**：移动手掌瞄准，捏合发射法术，阻止敌人攻破城堡。

## 运行网页版

确保本机已安装 Node.js，然后在项目目录运行：

```bash
npm start
```

浏览器访问：

```text
http://localhost:4173
```

也可以在 Finder 中双击：

```text
Start Gesture Arcade.command
```

首次使用时，点击首页的“开始检测”，并允许浏览器访问摄像头。

## 构建 macOS App

```bash
native/build-app.sh outputs
```

构建结果会生成在：

```text
outputs/Gesture Arcade.app
```

如果需要打包成 zip：

```bash
ditto -c -k --sequesterRsrc --keepParent "outputs/Gesture Arcade.app" "outputs/Gesture Arcade-macOS.zip"
```

## 摄像头权限

如果摄像头打不开，请检查：

1. macOS“系统设置 -> 隐私与安全性 -> 摄像头”中是否允许当前浏览器或 Gesture Arcade。
2. 摄像头是否被 FaceTime、Zoom、腾讯会议等应用占用。
3. 是否通过 `http://localhost:4173` 访问，而不是直接打开本地 HTML 文件。

## 技术栈

- HTML / CSS / Canvas
- JavaScript
- MediaPipe Tasks Vision
- Swift + WKWebView macOS wrapper

## 隐私说明

摄像头画面仅用于本机实时手势识别。游戏逻辑只读取手势结果和控制点位置，不会上传摄像头画面。
