logger.info(logger.yellow("- 正在加载 QQBot 适配器插件"))

import makeConfig from "../../lib/plugins/config.js"
import fs from "node:fs/promises"
import path from "node:path"
import QRCode from "qrcode"
import { ulid } from "ulid"
import imageSize from "image-size"
import urlRegexSafe from "url-regex-safe"
import { encode as encodeSilk, isSilk } from "silk-wasm"
import { Bot as QQBot } from "qq-group-bot"

const { config, configSave } = await makeConfig(
  "QQBot",
  {
    tips: "",
    permission: "master",
    toQRCode: true,
    toCallback: true,
    toBotUpload: true,
    hideGuildRecall: false,
    imageLength: 3,
    markdown: {
      template: "abcdefghij",
    },
    bot: {
      sandbox: false,
      maxRetry: Infinity,
      timeout: 30000,
    },
    token: [],
  },
  {
    tips: [
      "欢迎使用 TRSS-Yunzai QQBot Plugin ! 作者：时雨🌌星空",
      "参考：https://github.com/TimeRainStarSky/Yunzai-QQBot-Plugin",
    ],
  },
)

let sharp
if (config.imageLength)
  try {
    sharp = (await import("sharp")).default
  } catch (err) {
    Bot.makeLog("error", ["sharp 导入错误，图片压缩关闭", err], "QQBot-Plugin")
  }

const adapter = new (class QQBotAdapter {
  constructor() {
    this.id = "QQBot"
    this.name = "QQBot"
    this.path = "data/QQBot/"
    this.version = "qq-group-bot v1.1.0"

    switch (typeof config.toQRCode) {
      case "boolean":
        this.toQRCodeRegExp = config.toQRCode ? urlRegexSafe() : false
        break
      case "string":
        this.toQRCodeRegExp = new RegExp(config.toQRCode, "g")
        break
      case "object":
        this.toQRCodeRegExp = urlRegexSafe(config.toQRCode)
        break
    }

    this.sep = ":"
    if (process.platform === "win32") this.sep = ""
    this.bind_user = {}
    this.appid = {}
  }

  async makeRecord(file) {
    if (config.toBotUpload)
      for (const i of Bot.uin) {
        if (!Bot[i].uploadRecord) continue
        try {
          const url = await Bot[i].uploadRecord(file)
          if (url) return url
        } catch (err) {
          Bot.makeLog("error", ["Bot", i, "语音上传错误", file, err])
        }
      }
    const buffer = await Bot.Buffer(file)
    if (!Buffer.isBuffer(buffer)) return file
    if (isSilk(buffer)) return buffer

    const convFile = path.join("temp", ulid())
    try {
      await fs.writeFile(convFile, buffer)
      await Bot.exec(`ffmpeg -i "${convFile}" -f s16le -ar 48000 -ac 1 "${convFile}.pcm"`)
      file = Buffer.from((await encodeSilk(await fs.readFile(`${convFile}.pcm`), 48000)).data)
    } catch (err) {
      Bot.makeLog("error", ["silk 转码错误", file, err])
    }

    for (const i of [convFile, `${convFile}.pcm`]) fs.unlink(i).catch(() => {})

    return file
  }

  async makeQRCode(data) {
    return (await QRCode.toDataURL(data)).replace("data:image/png;base64,", "base64://")
  }

  async makeRawMarkdownText(data, text, button) {
    const match = text.match(this.toQRCodeRegExp)
    if (match)
      for (const url of match) {
        if (button) button.push(...this.makeButtons(data, [[{ text: url, link: url }]]))
        const img = await this.makeMarkdownImage(data, await this.makeQRCode(url), "二维码")
        text = text.replace(url, `${img.des}${img.url}`)
      }
    return text.replace(/@/g, "@​").replace(/<qqbot-/g, "<qqbot-​")
  }

  async makeBotImage(file) {
    if (config.toBotUpload)
      for (const i of Bot.uin) {
        if (!Bot[i].uploadImage) continue
        try {
          const image = await Bot[i].uploadImage(file)
          if (image.url) return image
        } catch (err) {
          Bot.makeLog("error", ["Bot", i, "图片上传错误", file, err])
        }
      }
  }

  async makeMarkdownImage(data, file, summary = "图片") {
    if (sharp) file = await this.compressImage(data, file)
    const buffer = await Bot.Buffer(file)
    const image = (await this.makeBotImage(buffer)) || { url: await Bot.fileToUrl(file) }

    if (!image.width || !image.height)
      try {
        const size = imageSize(buffer)
        image.width = size.width
        image.height = size.height
      } catch (err) {
        Bot.makeLog("error", ["图片分辨率检测错误", file, err], data.self_id)
      }

    return {
      des: `![${summary} #${image.width || 0}px #${image.height || 0}px]`,
      url: `(${image.url})`,
    }
  }

  makeButton(data, button, style) {
    const msg = {
      id: ulid(),
      render_data: {
        label: button.text,
        visited_label: button.clicked_text,
        style,
        ...button.QQBot?.render_data,
      },
    }

    if (button.input)
      msg.action = {
        type: 2,
        permission: { type: 2 },
        data: button.input,
        enter: button.send,
        ...button.QQBot?.action,
      }
    else if (button.callback) {
      if (config.toCallback) {
        msg.action = {
          type: 1,
          permission: { type: 2 },
          ...button.QQBot?.action,
        }
        if (!Array.isArray(data._ret_id)) data._ret_id = []
        data.bot.callback[msg.id] = {
          id: data.message_id,
          user_id: data.user_id,
          group_id: data.group_id,
          message: button.callback,
          message_id: data._ret_id,
        }
        setTimeout(() => delete data.bot.callback[msg.id], 300000)
      } else {
        msg.action = {
          type: 2,
          permission: { type: 2 },
          data: button.callback,
          enter: true,
          ...button.QQBot?.action,
        }
      }
    } else if (button.link)
      msg.action = {
        type: 0,
        permission: { type: 2 },
        data: button.link,
        ...button.QQBot?.action,
      }
    else return false

    if (button.permission) {
      if (button.permission === "admin") {
        msg.action.permission.type = 1
      } else {
        msg.action.permission.type = 0
        msg.action.permission.specify_user_ids = []
        if (!Array.isArray(button.permission)) button.permission = [button.permission]
        for (const id of button.permission)
          msg.action.permission.specify_user_ids.push(id.replace(`${data.self_id}${this.sep}`, ""))
      }
    }
    return msg
  }

  makeButtons(data, button_square) {
    const msgs = [],
      random = Math.floor(Math.random() * 2)
    for (const button_row of button_square) {
      let column = 0
      const buttons = []
      for (let button of button_row) {
        button = this.makeButton(data, button, (random + msgs.length + buttons.length) % 2)
        if (button) buttons.push(button)
      }
      if (buttons.length) msgs.push({ type: "button", buttons })
    }
    return msgs
  }

  makeTextChain(data, button) {
    let msg

    if (button.input) msg = `text="${button.input}"`
    else if (button.callback) msg = `text="${button.callback}"`
    else if (button.link) msg = `text="${button.link}"`
    else return false

    if (button.text) msg += ` show="[${button.text}]"`
    return `<qqbot-cmd-input ${msg} />`
  }

  makeTextChains(data, button_square) {
    const msgs = []
    for (const button_row of button_square) {
      const buttons = []
      for (let button of button_row) {
        button = this.makeTextChain(data, button)
        if (button) buttons.push(button)
      }
      if (buttons.length) msgs.push(buttons.join(" "))
    }
    if (msgs.length) msgs.unshift("")
    return msgs.join("\n")
  }

  async makeRawMarkdownMsg(data, msg, keyboard, nested) {
    const messages = [],
      button = []
    let content = "",
      reply

    for (let i of Array.isArray(msg) ? msg : [msg]) {
      if (typeof i === "object") i = { ...i }
      else i = { type: "text", text: Bot.String(i) }

      switch (i.type) {
        case "record":
          i.type = "audio"
          i.file = await this.makeRecord(i.file)
        case "video":
        case "face":
        case "ark":
        case "embed":
          messages.push([i])
          break
        case "file":
          if (i.file) i.file = await Bot.fileToUrl(i.file, i)
          content += await this.makeRawMarkdownText(data, `文件：${i.file}`, keyboard && button)
          break
        case "at":
          if (i.qq === "all") content += "<qqbot-at-everyone />"
          else
            content += `<qqbot-at-user id="${i.qq?.replace?.(`${data.self_id}${this.sep}`, "")}" />`
          break
        case "text":
          content += await this.makeRawMarkdownText(data, i.text, keyboard && button)
          break
        case "image": {
          const { des, url } = await this.makeMarkdownImage(data, i.file, i.summary)
          content += `${des}${url}`
          break
        }
        case "markdown":
          if (typeof i.data === "object") messages.push([{ type: "markdown", ...i.data }])
          else content += i.data
          break
        case "button":
          if (keyboard) button.push(...this.makeButtons(data, i.data))
          else content += this.makeTextChains(data, i.data)
          break
        case "reply":
          reply = i
          continue
        case "node":
          for (const { message } of i.data)
            messages.push(...(await this.makeRawMarkdownMsg(data, message, keyboard, true)))
          continue
        case "raw":
          messages.push(Array.isArray(i.data) ? i.data : [i.data])
          break
        default:
          content += await this.makeRawMarkdownText(data, Bot.String(i), keyboard && button)
      }
    }

    if (content) messages.unshift([{ type: "markdown", content }])

    if (button.length) {
      for (const i of messages) {
        if (i[0].type === "markdown") i.push(...button.splice(0, 5))
        if (!button.length) break
      }
      while (button.length)
        messages.push([{ type: "markdown", content: " " }, ...button.splice(0, 5)])
    }

    if (!reply && !nested && data.message_id) reply = segment.reply(data.message_id)
    if (reply) {
      if (reply.id.startsWith("event_"))
        reply = { type: "reply", event_id: reply.id.replace(/^event_/, "") }
      for (const i in messages) {
        if (Array.isArray(messages[i])) messages[i].unshift(reply)
        else messages[i] = [reply, messages[i]]
      }
    }
    return messages
  }

  makeMarkdownText_(data, text) {
    const match = text.match(this.toQRCodeRegExp)
    if (match)
      for (const url of match)
        text = text.replace(url, this.makeTextChain(data, { text: "链接", link: url }))
    return text
      .replace(/\n/g, "\r")
      .replace(/@/g, "@​")
      .replace(/<qqbot-/g, "<qqbot-​")
  }

  makeMarkdownText(data, text, content) {
    const match = text.match(/!?\[.*?\]\s*\(\w+:\/\/.*?\)/g)
    if (match) {
      const temp = []
      let last = ""
      for (const i of match) {
        const match = i.match(/(!?\[.*?\])\s*(\(\w+:\/\/.*?\))/)
        text = text.split(i)
        temp.push([last + this.makeMarkdownText_(data, text.shift()), match[1]])
        text = text.join(i)
        last = match[2]
      }
      temp[0][0] = content + temp[0][0]
      return [last + this.makeMarkdownText_(data, text), temp]
    }
    return [this.makeMarkdownText_(data, text)]
  }

  makeMarkdownTemplate(data, templates) {
    const msgs = []
    for (const template of templates) {
      if (!template.length) continue

      const params = []
      for (const i in template)
        params.push({
          key: config.markdown.template[i],
          values: [template[i]],
        })

      msgs.push([
        {
          type: "markdown",
          custom_template_id: config.markdown[data.self_id],
          params,
        },
      ])
    }
    return msgs
  }

  makeMarkdownTemplatePush(content, template, templates) {
    for (const i of content) {
      if (template.length === config.markdown.template.length - 1) {
        template.push(i.shift())
        template = i
        templates.push(template)
      } else {
        template.push(i.join(""))
      }
    }
    return template
  }

  async makeMarkdownMsg(data, msg, nested) {
    const messages = [],
      templates = [[]]
    let content = "",
      reply,
      template = templates[0]

    for (let i of Array.isArray(msg) ? msg : [msg]) {
      if (typeof i === "object") i = { ...i }
      else i = { type: "text", text: Bot.String(i) }

      switch (i.type) {
        case "record":
          i.type = "audio"
          i.file = await this.makeRecord(i.file)
        case "video":
        case "face":
        case "ark":
        case "embed":
          messages.push([i])
          break
        case "file":
          if (i.file) i.file = await Bot.fileToUrl(i.file, i)
          content += this.makeTextChain(data, { text: `文件：${i.name || i.file}`, link: i.file })
          break
        case "at":
          if (i.qq === "all") content += "<qqbot-at-everyone />"
          else
            content += `<qqbot-at-user id="${i.qq?.replace?.(`${data.self_id}${this.sep}`, "")}" />`
          break
        case "text": {
          const [text, temp] = this.makeMarkdownText(data, i.text, content)
          if (Array.isArray(temp)) {
            template = this.makeMarkdownTemplatePush(temp, template, templates)
            content = text
          } else {
            content += text
          }
          break
        }
        case "image": {
          const { des, url } = await this.makeMarkdownImage(data, i.file, i.summary)
          template = this.makeMarkdownTemplatePush([[content, des]], template, templates)
          content = url
          break
        }
        case "markdown":
          if (typeof i.data === "object") messages.push([{ type: "markdown", ...i.data }])
          else content += i.data
          break
        case "button":
          content += this.makeTextChains(data, i.data)
          break
        case "reply":
          reply = i
          continue
        case "node":
          for (const { message } of i.data)
            messages.push(...(await this.makeMarkdownMsg(data, message, true)))
          continue
        case "raw":
          messages.push(Array.isArray(i.data) ? i.data : [i.data])
          break
        default: {
          const [text, temp] = this.makeMarkdownText(data, Bot.String(i), content)
          if (Array.isArray(temp)) {
            template = this.makeMarkdownTemplatePush(temp, template, templates)
            content = text
          } else {
            content += text
          }
        }
      }
    }

    if (content) template.push(content)
    messages.push(...this.makeMarkdownTemplate(data, templates))

    if (!reply && !nested && data.message_id) reply = segment.reply(data.message_id)
    if (reply)
      for (const i of messages)
        i.unshift(
          reply.id.startsWith("event_")
            ? { type: "reply", event_id: reply.id.replace(/^event_/, "") }
            : reply,
        )
    return messages
  }

  async compressImage(data, file) {
    try {
      const size = config.imageLength * 1024 * 1024
      const buffer = await Bot.Buffer(file, { http: true })

      if (!Buffer.isBuffer(buffer)) return file

      if (buffer.length <= size) return buffer

      let quality = 105,
        output
      do {
        quality -= 10
        output = await sharp(buffer).jpeg({ quality }).toBuffer()
        Bot.makeLog(
          "debug",
          `图片压缩完成 ${quality}%(${(output.length / 1024).toFixed(2)}KB)`,
          data.self_id,
        )
      } while (output.length > size && quality > 10)

      return output
    } catch (err) {
      Bot.makeLog("error", ["图片压缩错误", err], data.self_id)
      return file
    }
  }

  async makeMsg(data, msg, nested) {
    const messages = [],
      button = []
    let message = [],
      reply

    for (let i of Array.isArray(msg) ? msg : [msg]) {
      if (typeof i === "object") i = { ...i }
      else i = { type: "text", text: Bot.String(i) }

      switch (i.type) {
        case "at":
          //i.user_id = i.qq?.replace?.(`${data.self_id}${this.sep}`, "")
          continue
        case "text":
          if (!i.text || !i.text.trim()) continue
          break
        case "face":
        case "ark":
        case "embed":
          break
        case "record":
          i.type = "audio"
          i.file = await this.makeRecord(i.file)
        case "video":
        case "image":
          if (message.length) {
            messages.push(message)
            message = []
          }

          if (sharp && i.file) i.file = await this.compressImage(data, i.file)
          break
        case "file":
          if (i.file) i.file = await Bot.fileToUrl(i.file, i)
          i = { type: "text", text: `文件：${i.file}` }
          break
        case "reply":
          reply = i
          continue
        case "markdown":
          if (typeof i.data === "object") i = { type: "markdown", ...i.data }
          else i = { type: "markdown", content: i.data }
          break
        case "button":
          //button.push(...this.makeButtons(data, i.data))
          continue
        case "node":
          for (const { message } of i.data)
            messages.push(...(await this.makeMsg(data, message, true)))
          continue
        case "raw":
          if (Array.isArray(i.data)) {
            messages.push(i.data)
            continue
          }
          i = i.data
          break
        default:
          i = { type: "text", text: Bot.String(i) }
      }

      if (i.type === "text" && i.text) {
        const match = i.text.match(this.toQRCodeRegExp)
        if (match)
          for (const url of match) {
            const msg = segment.image(await this.makeQRCode(url))
            if (message.length) {
              messages.push(message)
              message = []
            }
            message.push(msg)
            i.text = i.text.replace(url, "[链接(请扫码查看)]")
          }
      }

      message.push(i)
    }

    if (message.length) messages.push(message)

    while (button.length)
      messages.push([
        {
          type: "keyboard",
          content: { rows: button.splice(0, 5) },
        },
      ])

    if (!reply && !nested && data.message_id) reply = segment.reply(data.message_id)
    if (reply)
      for (const i of messages)
        i.unshift(
          reply.id.startsWith("event_")
            ? { type: "reply", event_id: reply.id.replace(/^event_/, "") }
            : reply,
        )
    return messages
  }

  async sendMsg(data, send, msg) {
    const rets = { message_id: [], data: [], error: [] }
    let msgs

    const sendMsg = async () => {
      for (const i of msgs)
        try {
          Bot.makeLog("debug", ["发送消息", i], data.self_id)
          const ret = await send(i)
          Bot.makeLog("debug", ["发送消息返回", ret], data.self_id)

          rets.data.push(ret)
          if (ret.id) rets.message_id.push(ret.id)
        } catch (err) {
          Bot.makeLog("error", ["发送消息错误", i, err], data.self_id)
          rets.error.push(err)
          return false
        }
    }

    if (!config.markdown[data.self_id] || config.markdown[data.self_id] === "raw")
      msgs = await this.makeRawMarkdownMsg(data, msg, true)
    else if (config.markdown[data.self_id] === "legacy") msgs = await this.makeMsg(data, msg)
    else if (config.markdown[data.self_id] === "inline")
      msgs = await this.makeRawMarkdownMsg(data, msg)
    else msgs = await this.makeMarkdownMsg(data, msg)

    if ((await sendMsg()) === false) {
      msgs = await this.makeMsg(data, msg)
      await sendMsg()
    }

    if (Array.isArray(data._ret_id)) data._ret_id.push(...rets.message_id)
    return rets
  }

  sendFriendMsg(data, msg) {
    return this.sendMsg(data, msg => data.bot.sdk.sendPrivateMessage(data.user_id, msg), msg)
  }

  sendGroupMsg(data, msg) {
    return this.sendMsg(data, msg => data.bot.sdk.sendGroupMessage(data.group_id, msg), msg)
  }

  async makeGuildMsg(data, msg, nested) {
    const messages = []
    let message = [],
      reply
    for (let i of Array.isArray(msg) ? msg : [msg]) {
      if (typeof i === "object") i = { ...i }
      else i = { type: "text", text: Bot.String(i) }

      switch (i.type) {
        case "at":
          i.user_id = i.qq?.replace?.(/^qg_/, "")
        case "text":
        case "face":
        case "ark":
        case "embed":
          break
        case "image":
          message.push(i)
          messages.push(message)
          message = []
          continue
        case "record":
        case "video":
        case "file":
          if (i.file) i.file = await Bot.fileToUrl(i.file, i)
          i = { type: "text", text: `文件：${i.file}` }
          break
        case "reply":
          reply = i
          continue
        case "markdown":
          if (typeof i.data === "object") i = { type: "markdown", ...i.data }
          else i = { type: "markdown", content: i.data }
          break
        case "button":
          continue
        case "node":
          for (const { message } of i.data)
            messages.push(...(await this.makeGuildMsg(data, message, true)))
          continue
        case "raw":
          if (Array.isArray(i.data)) {
            messages.push(i.data)
            continue
          }
          i = i.data
          break
        default:
          i = { type: "text", text: Bot.String(i) }
      }

      if (i.type === "text" && i.text) {
        const match = i.text.match(this.toQRCodeRegExp)
        if (match)
          for (const url of match) {
            const msg = segment.image(await this.makeQRCode(url))
            message.push(msg)
            messages.push(message)
            message = []
            i.text = i.text.replace(url, "[链接(请扫码查看)]")
          }
      }

      message.push(i)
    }

    if (message.length) messages.push(message)
    if (!reply && !nested && data.message_id) reply = segment.reply(data.message_id)
    if (reply)
      for (const i of messages)
        i.unshift(
          reply.id.startsWith("event_")
            ? { type: "reply", event_id: reply.id.replace(/^event_/, "") }
            : reply,
        )
    return messages
  }

  async sendGMsg(data, send, msg) {
    const rets = { message_id: [], data: [], error: [] }
    let msgs

    const sendMsg = async () => {
      for (const i of msgs)
        try {
          Bot.makeLog("debug", ["发送消息", i], data.self_id)
          const ret = await send(i)
          Bot.makeLog("debug", ["发送消息返回", ret], data.self_id)

          rets.data.push(ret)
          if (ret.id) rets.message_id.push(ret.id)
        } catch (err) {
          Bot.makeLog("error", ["发送消息错误", i, err], data.self_id)
          rets.error.push(err)
          return false
        }
    }

    msgs = await this.makeGuildMsg(data, msg)
    if ((await sendMsg()) === false) {
      msgs = await this.makeGuildMsg(data, msg)
      await sendMsg()
    }
    return rets
  }

  async sendDirectMsg(data, msg) {
    if (!data.guild_id) {
      if (!data.src_guild_id) {
        Bot.makeLog(
          "error",
          [`发送频道私聊消息失败：[${data.user_id}] 不存在来源频道信息`, msg],
          data.self_id,
        )
        return false
      }
      const dms = await data.bot.sdk.createDirectSession(data.src_guild_id, data.user_id)
      data.guild_id = dms.guild_id
      data.channel_id = dms.channel_id
      data.bot.fl.set(`qg_${data.user_id}`, {
        ...data.bot.fl.get(`qg_${data.user_id}`),
        ...dms,
      })
    }
    return this.sendGMsg(data, msg => data.bot.sdk.sendDirectMessage(data.guild_id, msg), msg)
  }

  sendGuildMsg(data, msg) {
    return this.sendGMsg(data, msg => data.bot.sdk.sendGuildMessage(data.channel_id, msg), msg)
  }

  async recallMsg(data, recall, message_id) {
    if (!Array.isArray(message_id)) message_id = [message_id]
    const msgs = []
    for (const i of message_id)
      try {
        msgs.push(await recall(i))
      } catch (err) {
        Bot.makeLog("debug", ["撤回消息错误", i, err], data.self_id)
        msgs.push(false)
      }
    return msgs
  }

  recallFriendMsg(data, message_id) {
    Bot.makeLog("info", `撤回好友消息：[${data.user_id}] ${message_id}`, data.self_id)
    return this.recallMsg(data, i => data.bot.sdk.recallFriendMessage(data.user_id, i), message_id)
  }

  recallGroupMsg(data, message_id) {
    Bot.makeLog("info", `撤回群消息：[${data.group_id}] ${message_id}`, data.self_id)
    return this.recallMsg(data, i => data.bot.sdk.recallGroupMessage(data.group_id, i), message_id)
  }

  recallDirectMsg(data, message_id, hide = config.hideGuildRecall) {
    Bot.makeLog(
      "info",
      `撤回${hide ? "并隐藏" : ""}频道私聊消息：[${data.guild_id}] ${message_id}`,
      data.self_id,
    )
    return this.recallMsg(
      data,
      i => data.bot.sdk.recallDirectMessage(data.guild_id, i, hide),
      message_id,
    )
  }

  recallGuildMsg(data, message_id, hide = config.hideGuildRecall) {
    Bot.makeLog(
      "info",
      `撤回${hide ? "并隐藏" : ""}频道消息：[${data.channel_id}] ${message_id}`,
      data.self_id,
    )
    return this.recallMsg(
      data,
      i => data.bot.sdk.recallGuildMessage(data.channel_id, i, hide),
      message_id,
    )
  }

  pickFriend(id, user_id) {
    if (typeof user_id !== "string") user_id = String(user_id)
    else if (user_id.startsWith("qg_")) return this.pickGuildFriend(id, user_id)
    const i = {
      ...Bot[id].fl.get(user_id),
      self_id: id,
      bot: Bot[id],
      user_id: user_id.replace(`${id}${this.sep}`, ""),
    }
    return {
      ...i,
      sendMsg: msg => this.sendFriendMsg(i, msg),
      recallMsg: message_id => this.recallFriendMsg(i, message_id),
      getAvatarUrl: () => `https://q.qlogo.cn/qqapp/${i.bot.info.appid}/${i.user_id}/0`,
    }
  }

  pickMember(id, group_id, user_id) {
    if (typeof group_id !== "string") group_id = String(group_id)
    if (typeof user_id !== "string") user_id = String(user_id)
    else if (user_id.startsWith("qg_")) return this.pickGuildMember(id, group_id, user_id)
    const i = {
      ...Bot[id].fl.get(user_id),
      ...Bot[id].gml.get(group_id)?.get(user_id),
      self_id: id,
      bot: Bot[id],
      user_id: user_id.replace(`${id}${this.sep}`, ""),
      group_id: group_id.replace(`${id}${this.sep}`, ""),
    }
    return {
      ...this.pickFriend(id, user_id),
      ...i,
    }
  }

  pickGroup(id, group_id) {
    if (typeof group_id !== "string") group_id = String(group_id)
    else if (group_id.startsWith("qg_")) return this.pickGuild(id, group_id)
    const i = {
      ...Bot[id].gl.get(group_id),
      self_id: id,
      bot: Bot[id],
      group_id: group_id.replace(`${id}${this.sep}`, ""),
    }
    return {
      ...i,
      sendMsg: msg => this.sendGroupMsg(i, msg),
      recallMsg: message_id => this.recallGroupMsg(i, message_id),
      pickMember: user_id => this.pickMember(id, group_id, user_id),
      getMemberMap: () => i.bot.gml.get(group_id),
    }
  }

  pickGuildFriend(id, user_id) {
    const i = {
      ...Bot[id].fl.get(user_id),
      self_id: id,
      bot: Bot[id],
      user_id: user_id.replace(/^qg_/, ""),
    }
    return {
      ...i,
      sendMsg: msg => this.sendDirectMsg(i, msg),
      recallMsg: (message_id, hide) => this.recallDirectMsg(i, message_id, hide),
    }
  }

  pickGuildMember(id, group_id, user_id) {
    const guild_id = group_id.replace(/^qg_/, "").split("-")
    const i = {
      ...Bot[id].fl.get(user_id),
      ...Bot[id].gml.get(group_id)?.get(user_id),
      self_id: id,
      bot: Bot[id],
      src_guild_id: guild_id[0],
      src_channel_id: guild_id[1],
      user_id: user_id.replace(/^qg_/, ""),
    }
    return {
      ...this.pickGuildFriend(id, user_id),
      ...i,
      sendMsg: msg => this.sendDirectMsg(i, msg),
      recallMsg: (message_id, hide) => this.recallDirectMsg(i, message_id, hide),
    }
  }

  pickGuild(id, group_id) {
    const guild_id = group_id.replace(/^qg_/, "").split("-")
    const i = {
      ...Bot[id].gl.get(group_id),
      self_id: id,
      bot: Bot[id],
      guild_id: guild_id[0],
      channel_id: guild_id[1],
    }
    return {
      ...i,
      sendMsg: msg => this.sendGuildMsg(i, msg),
      recallMsg: (message_id, hide) => this.recallGuildMsg(i, message_id, hide),
      pickMember: user_id => this.pickGuildMember(id, group_id, user_id),
      getMemberMap: () => i.bot.gml.get(group_id),
    }
  }

  async makeFriendMessage(data, event) {
    data.sender = {
      user_id: `${data.self_id}${this.sep}${event.sender.user_id}`,
    }
    Bot.makeLog("info", `好友消息：[${data.user_id}] ${data.raw_message}`, data.self_id)

    data.reply = msg =>
      this.sendFriendMsg(
        {
          ...data,
          user_id: event.sender.user_id,
        },
        msg,
      )
    await this.setFriendMap(data)
  }

  async makeGroupMessage(data, event) {
    data.sender = {
      user_id: `${data.self_id}${this.sep}${event.sender.user_id}`,
    }
    data.group_id = `${data.self_id}${this.sep}${event.group_id}`
    Bot.makeLog(
      "info",
      `群消息：[${data.group_id}, ${data.user_id}] ${data.raw_message}`,
      data.self_id,
    )

    data.reply = msg =>
      this.sendGroupMsg(
        {
          ...data,
          group_id: event.group_id,
        },
        msg,
      )
    data.message.unshift({ type: "at", qq: data.self_id })
    await this.setGroupMap(data)
  }

  async makeDirectMessage(data, event) {
    data.sender = {
      ...data.bot.fl.get(`qg_${event.sender.user_id}`),
      ...event.sender,
      user_id: `qg_${event.sender.user_id}`,
      nickname: event.sender.user_name,
      avatar: event.author.avatar,
      guild_id: event.guild_id,
      channel_id: event.channel_id,
      src_guild_id: event.src_guild_id,
    }
    Bot.makeLog(
      "info",
      `频道私聊消息：[${data.sender.nickname}(${data.user_id})] ${data.raw_message}`,
      data.self_id,
    )

    data.reply = msg =>
      this.sendDirectMsg(
        {
          ...data,
          user_id: event.user_id,
          guild_id: event.guild_id,
          channel_id: event.channel_id,
        },
        msg,
      )
    await this.setFriendMap(data)
  }

  async makeGuildMessage(data, event) {
    data.message_type = "group"
    data.sender = {
      ...data.bot.fl.get(`qg_${event.sender.user_id}`),
      ...event.sender,
      user_id: `qg_${event.sender.user_id}`,
      nickname: event.sender.user_name,
      card: event.member.nick,
      avatar: event.author.avatar,
      src_guild_id: event.guild_id,
      src_channel_id: event.channel_id,
    }
    data.group_id = `qg_${event.guild_id}-${event.channel_id}`
    Bot.makeLog(
      "info",
      `频道消息：[${data.group_id}, ${data.sender.nickname}(${data.user_id})] ${data.raw_message}`,
      data.self_id,
    )
    data.reply = msg =>
      this.sendGuildMsg(
        {
          ...data,
          guild_id: event.guild_id,
          channel_id: event.channel_id,
        },
        msg,
      )
    await this.setFriendMap(data)
    await this.setGroupMap(data)
  }

  async setFriendMap(data) {
    if (!data.user_id) return
    await data.bot.fl.set(data.user_id, {
      ...data.bot.fl.get(data.user_id),
      ...data.sender,
      message_id: data.message_id,
    })
  }

  async setGroupMap(data) {
    if (!data.group_id) return
    await data.bot.gl.set(data.group_id, {
      ...data.bot.gl.get(data.group_id),
      group_id: data.group_id,
      message_id: data.message_id,
    })
    let gml = data.bot.gml.get(data.group_id)
    if (!gml) {
      gml = new Map()
      await data.bot.gml.set(data.group_id, gml)
    }
    await gml.set(data.user_id, {
      ...gml.get(data.user_id),
      ...data.sender,
    })
  }

  async makeMessage(id, event) {
    const data = {
      raw: event,
      bot: Bot[id],
      self_id: id,
      post_type: event.post_type,
      message_type: event.message_type,
      sub_type: event.sub_type,
      message_id: event.message_id,
      get user_id() {
        return this.sender.user_id
      },
      message: event.message,
      raw_message: event.raw_message,
    }

    for (const i of data.message)
      switch (i.type) {
        case "at":
          if (data.message_type === "group") i.qq = `${data.self_id}${this.sep}${i.user_id}`
          else i.qq = `qg_${i.user_id}`
          break
      }

    switch (data.message_type) {
      case "private":
        if (data.sub_type === "friend") await this.makeFriendMessage(data, event)
        else await this.makeDirectMessage(data, event)
        break
      case "group":
        await this.makeGroupMessage(data, event)
        break
      case "guild":
        await this.makeGuildMessage(data, event)
        break
      default:
        Bot.makeLog("warn", ["未知消息", event], id)
        return
    }

    Bot.em(`${data.post_type}.${data.message_type}.${data.sub_type}`, data)
  }

  async makeBotCallback(id, event, callback) {
    const data = {
      raw: event,
      bot: Bot[callback.self_id],
      self_id: callback.self_id,
      post_type: "message",
      message_id: event.event_id ? `event_${event.event_id}` : event.notice_id,
      message_type: callback.group_id ? "group" : "private",
      sub_type: "callback",
      get user_id() {
        return this.sender.user_id
      },
      sender: { user_id: `${id}${this.sep}${event.operator_id}` },
      message: [],
      raw_message: "",
    }

    data.message.push(
      { type: "at", qq: callback.self_id },
      { type: "text", text: callback.message },
    )
    data.raw_message += callback.message

    if (callback.group_id) {
      data.group_id = callback.group_id
      data.group = data.bot.pickGroup(callback.group_id)
      data.group_name = data.group.name
      data.friend = Bot[id].pickFriend(data.user_id)
      if (data.friend.real_id) {
        data.friend = data.bot.pickFriend(data.friend.real_id)
        data.member = data.group.pickMember(data.friend.user_id)
        data.sender = {
          ...((await data.member.getInfo()) || data.member),
        }
      } else {
        if (Bot[id].callback[data.user_id]) return event.reply(3)
        Bot[id].callback[data.user_id] = true

        let msg = `请先发送 #QQBot绑定用户${data.user_id}`
        const real_id = callback.message.replace(/^#[Qq]+[Bb]ot绑定用户确认/, "").trim()
        if (this.bind_user[real_id] === data.user_id) {
          await Bot[id].fl.set(data.user_id, {
            ...Bot[id].fl.get(data.user_id),
            real_id,
          })
          msg = `绑定成功 ${data.user_id} → ${real_id}`
        }

        event.reply(0)
        return data.group.sendMsg(msg)
      }
      Bot.makeLog(
        "info",
        [
          `群按钮点击事件：[${data.group_name}(${data.group_id}), ${data.sender.nickname}(${data.user_id})]`,
          data.raw_message,
        ],
        data.self_id,
      )
    } else {
      await Bot[id].fl.set(data.user_id, {
        ...Bot[id].fl.get(data.user_id),
        real_id: callback.user_id,
      })
      data.friend = data.bot.pickFriend(callback.user_id)
      data.sender = {
        ...((await data.friend.getInfo()) || data.friend),
      }
      Bot.makeLog(
        "info",
        [`好友按钮点击事件：[${data.sender.nickname}(${data.user_id})]`, data.raw_message],
        data.self_id,
      )
    }

    event.reply(0)
    Bot.em(`${data.post_type}.${data.message_type}.${data.sub_type}`, data)
  }

  async makeCallback(id, event) {
    const reply = event.reply.bind(event)
    event.reply = async (...args) => {
      try {
        return await reply(...args)
      } catch (err) {
        Bot.makeLog("debug", ["回复按钮点击事件错误", err], data.self_id)
      }
    }

    const data = {
      raw: event,
      bot: Bot[id],
      self_id: id,
      post_type: "message",
      message_id: event.event_id ? `event_${event.event_id}` : event.notice_id,
      message_type: event.notice_type,
      sub_type: "callback",
      get user_id() {
        return this.sender.user_id
      },
      sender: { user_id: `${id}${this.sep}${event.operator_id}` },
      message: [],
      raw_message: "",
    }

    const callback = data.bot.callback[event.data?.resolved?.button_id]
    if (callback) {
      if (callback.self_id) return this.makeBotCallback(id, event, callback)
      if (!event.group_id && callback.group_id) event.group_id = callback.group_id
      if (callback.message_id.length) {
        for (const id of callback.message_id) data.message.push({ type: "reply", id })
        data.raw_message += `[回复：${callback.message_id}]`
      }
      data.message.push({ type: "text", text: callback.message })
      data.raw_message += callback.message
    } else {
      if (event.data?.resolved?.button_id) {
        data.message.push({ type: "reply", id: event.data?.resolved?.button_id })
        data.raw_message += `[回复：${event.data?.resolved?.button_id}]`
      }
      if (event.data?.resolved?.button_data) {
        data.message.push({ type: "text", text: event.data?.resolved?.button_data })
        data.raw_message += event.data?.resolved?.button_data
      } else {
        event.reply(1)
      }
    }
    event.reply(0)

    switch (data.message_type) {
      case "friend":
        data.message_type = "private"
        Bot.makeLog("info", [`好友按钮点击事件：[${data.user_id}]`, data.raw_message], data.self_id)

        data.reply = msg => this.sendFriendMsg({ ...data, user_id: event.operator_id }, msg)
        await this.setFriendMap(data)
        break
      case "group":
        data.group_id = `${id}${this.sep}${event.group_id}`
        Bot.makeLog(
          "info",
          [`群按钮点击事件：[${data.group_id}, ${data.user_id}]`, data.raw_message],
          data.self_id,
        )

        data.reply = msg => this.sendGroupMsg({ ...data, group_id: event.group_id }, msg)
        await this.setGroupMap(data)
        break
      case "guild":
        break
      default:
        Bot.makeLog("warn", ["未知按钮点击事件", event], data.self_id)
    }

    Bot.em(`${data.post_type}.${data.message_type}.${data.sub_type}`, data)
  }

  makeNotice(id, event) {
    const data = {
      raw: event,
      bot: Bot[id],
      self_id: id,
      post_type: event.post_type,
      notice_type: event.notice_type,
      sub_type: event.sub_type,
      notice_id: event.notice_id,
    }

    switch (data.sub_type) {
      case "action":
        return this.makeCallback(id, event)
      case "increase":
      case "decrease":
      case "update":
      case "member.increase":
      case "member.decrease":
      case "member.update":
        break
      default:
        Bot.makeLog("warn", ["未知通知", event], id)
        return
    }

    //Bot.em(`${data.post_type}.${data.notice_type}.${data.sub_type}`, data)
  }

  getFriendMap(id) {
    return Bot.getMap(`${this.path}${id}/Friend`)
  }

  getGroupMap(id) {
    return Bot.getMap(`${this.path}${id}/Group`)
  }

  getMemberMap(id) {
    return Bot.getMap(`${this.path}${id}/Member`)
  }

  async connect(token) {
    token = token.split(":")
    const id = token[0]
    const opts = {
      ...config.bot,
      appid: token[1],
      token: token[2],
      secret: token[3],
      intents: [
        "GUILDS",
        "GUILD_MEMBERS",
        "GUILD_MESSAGE_REACTIONS",
        "DIRECT_MESSAGE",
        "INTERACTION",
        "MESSAGE_AUDIT",
      ],
    }

    if (Number(token[4])) opts.intents.push("GROUP_AT_MESSAGE_CREATE", "C2C_MESSAGE_CREATE")

    if (Number(token[5])) opts.intents.push("GUILD_MESSAGES")
    else opts.intents.push("PUBLIC_GUILD_MESSAGES")

    Bot[id] = {
      adapter: this,
      sdk: new QQBot(opts),
      login() {
        return new Promise(resolve => {
          this.sdk.sessionManager.once("READY", resolve)
          this.sdk.start()
        })
      },
      logout() {
        return new Promise(resolve => {
          this.sdk.ws.once("close", resolve)
          this.sdk.stop()
        })
      },

      uin: id,
      info: {
        id,
        ...opts,
        avatar: `https://q.qlogo.cn/g?b=qq&s=0&nk=${this.uin}`,
      },
      get nickname() {
        return this.info.username
      },
      get avatar() {
        return this.info.avatar
      },

      version: {
        id: this.id,
        name: this.name,
        version: this.version,
      },
      stat: { start_time: Date.now() / 1000 },

      pickFriend: user_id => this.pickFriend(id, user_id),
      get pickUser() {
        return this.pickFriend
      },
      getFriendMap() {
        return this.fl
      },
      fl: await this.getFriendMap(id),

      pickMember: (group_id, user_id) => this.pickMember(id, group_id, user_id),
      pickGroup: group_id => this.pickGroup(id, group_id),
      getGroupMap() {
        return this.gl
      },
      gl: await this.getGroupMap(id),
      gml: await this.getMemberMap(id),

      callback: {},
    }

    Bot[id].sdk.logger = {}
    for (const i of ["trace", "debug", "info", "mark", "warn", "error", "fatal"])
      Bot[id].sdk.logger[i] = (...args) => {
        if (args[0]?.startsWith?.("recv from")) return
        return Bot.makeLog(i, args, id)
      }

    try {
      if (token[4] === "2") {
        await Bot[id].sdk.sessionManager.getAccessToken()
        Bot[id].login = () => (this.appid[opts.appid] = Bot[id])
        Bot[id].logout = () => delete this.appid[opts.appid]
      }

      await Bot[id].login()
      Object.assign(Bot[id].info, await Bot[id].sdk.getSelfInfo())
    } catch (err) {
      Bot.makeLog("error", [`${this.name}(${this.id}) ${this.version} 连接失败`, err], id)
      return false
    }

    Bot[id].sdk.on("message", event => this.makeMessage(id, event))
    Bot[id].sdk.on("notice", event => this.makeNotice(id, event))

    Bot.makeLog("mark", `${this.name}(${this.id}) ${this.version} ${Bot[id].nickname} 已连接`, id)
    Bot.em(`connect.${id}`, { self_id: id })
    return true
  }

  async makeWebHookSign(id, req, secret) {
    const { sign } = (await import("tweetnacl")).default
    const { plain_token, event_ts } = req.body.d
    while (secret.length < 32) secret = secret.repeat(2).slice(0, 32)
    const signature = Buffer.from(
      sign.detached(
        Buffer.from(`${event_ts}${plain_token}`),
        sign.keyPair.fromSeed(Buffer.from(secret)).secretKey,
      ),
    ).toString("hex")
    Bot.makeLog("debug", ["QQBot 签名生成", { plain_token, signature }], id)
    req.res.send({ plain_token, signature })
  }

  makeWebHook(req) {
    const appid = req.headers["x-bot-appid"]
    if (!(appid in this.appid)) return Bot.makeLog("warn", "找不到对应 QQBot", appid)
    if ("plain_token" in req.body?.d)
      return this.makeWebHookSign(this.appid[appid].uin, req, this.appid[appid].info.secret)
    if ("t" in req.body) this.appid[appid].sdk.dispatchEvent(req.body.t, req.body)
    req.res.sendStatus(200)
  }

  async load() {
    Bot.express.use(`/${this.name}`, this.makeWebHook.bind(this))
    Bot.express.quiet.push(`/${this.name}`)
    for (const token of config.token) await Bot.sleep(5000, this.connect(token))
  }
})()

Bot.adapter.push(adapter)

export class QQBotAdapter extends plugin {
  constructor() {
    super({
      name: "QQBotAdapter",
      dsc: "QQBot 适配器设置",
      event: "message",
      rule: [
        {
          reg: "^#[Qq]+[Bb]ot账号$",
          fnc: "List",
          permission: config.permission,
        },
        {
          reg: "^#[Qq]+[Bb]ot设置[0-9]+:[0-9]+:.+:.+:([01]:[01]|2)$",
          fnc: "Token",
          permission: config.permission,
        },
        {
          reg: "^#[Qq]+[Bb]ot[Mm](ark)?[Dd](own)?[0-9]+:",
          fnc: "Markdown",
          permission: config.permission,
        },
        {
          reg: "^#[Qq]+[Bb]ot绑定用户.+$",
          fnc: "BindUser",
        },
      ],
    })
  }

  List() {
    this.reply(`共${config.token.length}个账号：\n${config.token.join("\n")}`, true)
  }

  async Token() {
    const token = this.e.msg.replace(/^#[Qq]+[Bb]ot设置/, "").trim()
    if (config.token.includes(token)) {
      config.token = config.token.filter(item => item !== token)
      this.reply(`账号已删除，重启后生效，共${config.token.length}个账号`, true)
    } else {
      if (await adapter.connect(token)) {
        config.token.push(token)
        this.reply(`账号已连接，共${config.token.length}个账号`, true)
      } else {
        this.reply(`账号连接失败`, true)
        return false
      }
    }
    await configSave()
  }

  async Markdown() {
    let token = this.e.msg
      .replace(/^#[Qq]+[Bb]ot[Mm](ark)?[Dd](own)?/, "")
      .trim()
      .split(":")
    const bot_id = token.shift()
    token = token.join(":")
    this.reply(`Bot ${bot_id} Markdown 模板已设置为 ${token}`, true)
    config.markdown[bot_id] = token
    await configSave()
  }

  BindUser() {
    const id = this.e.msg.replace(/^#[Qq]+[Bb]ot绑定用户(确认)?/, "").trim()
    if (id === this.e.user_id) return this.reply("请切换到对应Bot")

    adapter.bind_user[this.e.user_id] = id
    this.reply([
      `绑定 ${id} → ${this.e.user_id}`,
      segment.button([
        {
          text: "确认绑定",
          callback: `#QQBot绑定用户确认${this.e.user_id}`,
          permission: this.e.user_id,
        },
      ]),
    ])
  }
}

logger.info(logger.green("- QQBot 适配器插件 加载完成"))
