<div align="center">

# TRSS-Yunzai QQBot Plugin

TRSS-Yunzai QQBot 适配器 插件

[![访问量](https://visitor-badge.glitch.me/badge?page_id=TimeRainStarSky.Yunzai-QQBot-Plugin&right_color=red&left_text=访%20问%20量)](https://github.com/TimeRainStarSky/Yunzai-QQBot-Plugin)
[![Stars](https://img.shields.io/github/stars/TimeRainStarSky/Yunzai-QQBot-Plugin?color=yellow&label=收藏)](../../stargazers)
[![Downloads](https://img.shields.io/github/downloads/TimeRainStarSky/Yunzai-QQBot-Plugin/total?color=blue&label=下载)](../../archive/main.tar.gz)
[![Releases](https://img.shields.io/github/v/release/TimeRainStarSky/Yunzai-QQBot-Plugin?color=green&label=发行版)](../../releases/latest)

[![访问量](https://profile-counter.glitch.me/TimeRainStarSky-Yunzai-QQBot-Plugin/count.svg)](https://github.com/TimeRainStarSky/Yunzai-QQBot-Plugin)

</div>

## 安装教程

1. 准备：[TRSS-Yunzai](../../../Yunzai)
2. 输入：`#安装QQBot-Plugin`
3. 打开：[QQ 开放平台](https://q.qq.com) 创建 Bot：  
① 创建机器人  
② 开发设置 → 得到 `机器人QQ号:AppID:Token:AppSecret`  
4. 输入：`#QQBot设置机器人QQ号:AppID:Token:AppSecret:[01]:[01]`

## 格式示例

- 机器人QQ号 `114` AppID `514` Token `1919` AppSecret `810` 群Bot 频道私域

```
#QQBot设置114:514:1919:810:1:1
```

## 高阶能力

<details><summary>Markdown 消息</summary>

高阶能力 → 消息模板 → 添加 Markdown 模板

模板名称：多图文消息  
使用场景：发送连续图文消息  
Markdown 源码：

```
{{.a}}{{.b}}{{.c}}{{.d}}{{.e}}{{.f}}{{.g}}{{.h}}{{.i}}{{.j}}
```

配置模板参数
| 模板参数 | 参数示例 |
| - | - |
| a | 0 |
| b | 1 |
| c | 2 |
| d | 3 |
| e | 4 |
| f | 5 |
| g | 6 |
| h | 7 |
| i | 8 |
| j | 9 |

保存 → 提交审核 → 审核完成后，输入 `#QQBotMD机器人QQ号:模板ID`

</details>

## 使用教程

- #QQBot账号
- #QQBot设置 + `机器人QQ号:AppID:Token:AppSecret:是否群Bot:是否频道私域`（是1 否0）
- #QQBotMD + `机器人QQ号:模板ID`