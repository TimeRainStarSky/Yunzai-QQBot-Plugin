logger.info(logger.yellow("- 正在加载 QQBot 适配器插件"))

import { config, configSave } from "./Model/config.js"
import fs from "node:fs"
import path from "node:path"
import QRCode from "qrcode"
import imageSize from "image-size"
import { randomUUID } from "node:crypto"
import { encode as encodeSilk } from "silk-wasm"
import { Bot as QQBot } from "qq-group-bot"

const adapter = new class QQBotAdapter {
  constructor() {
    this.id = "QQBot"
    this.name = "QQBot"
    this.path = "data/QQBot/"
    this.version = `qq-group-bot ${config.package.dependencies["qq-group-bot"].replace("^", "v")}`

    if (typeof config.toQRCode == "boolean")
      this.toQRCodeRegExp = config.toQRCode ? /https?:\/\/[\w\-_]+(\.[\w\-_]+)+([\w\-\.,@?^=%&:/~\+#]*[\w\-\@?^=%&/~\+#])?/g : false
    else
      this.toQRCodeRegExp = new RegExp(config.toQRCode, "g")

    this.sep = ":"
    if (process.platform == "win32") this.sep = ""
    this.bind_user = {}
  }

  async makeSilk(file) {
    const inputFile = path.join("temp", randomUUID())
    const pcmFile = path.join("temp", randomUUID())

    try {
      fs.writeFileSync(inputFile, await Bot.Buffer(file))
      await Bot.exec(`ffmpeg -i "${inputFile}" -f s16le -ar 48000 -ac 1 "${pcmFile}"`)
      file = Buffer.from((await encodeSilk(fs.readFileSync(pcmFile), 48000)).data)
    } catch (err) {
      logger.error(`silk 转码错误：${err}`)
    }

    for (const i of [inputFile, pcmFile])
      try { fs.unlinkSync(i) } catch (err) {}

    return file
  }

  async makeQRCode(data) {
    return (await QRCode.toDataURL(data)).replace("data:image/png;base64,", "base64://")
  }

  async makeRawMarkdownText(data, text, button) {
    const match = text.match(this.toQRCodeRegExp)
    if (match) for (const url of match) {
      button.push(...this.makeButtons(data, [[{ text: url, link: url }]]))
      const img = await this.makeMarkdownImage(await this.makeQRCode(url))
      text = text.replace(url, `${img.des}${img.url}`)
    }
    return text.replace(/@/g, "@​")
  }

  async makeBotImage(file) {
    if (config.toBotUpload) for (const i of Bot.uin) {
      if (!Bot[i].uploadImage) continue
      try {
        const image = await Bot[i].uploadImage(file)
        if (image.url) return image
      } catch (err) {
        Bot.makeLog("error", ["Bot", i, "图片上传错误", file, err])
      }
    }
  }

  async makeMarkdownImage(file) {
    const image = await this.makeBotImage(file) || {
      url: await Bot.fileToUrl(file),
    }

    if (!image.width || !image.height) try {
      const size = imageSize(await Bot.Buffer(file))
      image.width = size.width
      image.height = size.height
    } catch (err) {
      Bot.makeLog("error", ["图片分辨率检测错误", file, err])
    }

    return {
      des: `![图片 #${image.width || 0}px #${image.height || 0}px]`,
      url: `(${image.url})`,
    }
  }

  makeButton(data, button, style) {
    const msg = {
      id: randomUUID(),
      render_data: {
        label: button.text,
        visited_label: button.clicked_text,
        style,
        ...button.QQBot?.render_data,
      }
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
        if (!Array.isArray(data._ret_id))
          data._ret_id = []
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
      if (button.permission == "admin") {
        msg.action.permission.type = 1
      } else {
        msg.action.permission.type = 0
        msg.action.permission.specify_user_ids = []
        if (!Array.isArray(button.permission))
          button.permission = [button.permission]
        for (const id of button.permission)
          msg.action.permission.specify_user_ids.push(id.replace(`${data.self_id}${this.sep}`, ""))
      }
    }
    return msg
  }

  makeButtons(data, button_square) {
    const msgs = []
    const random = Math.floor(Math.random()*2)
    for (const button_row of button_square) {
      let column = 0
      const buttons = []
      for (let button of button_row) {
        button = this.makeButton(data, button,
          (random+msgs.length+buttons.length)%2)
        if (button) buttons.push(button)
      }
      if (buttons.length)
        msgs.push({ type: "button", buttons })
    }
    return msgs
  }

  async makeRawMarkdownMsg(data, msg) {
    if (!Array.isArray(msg))
      msg = [msg]
    const messages = []
    let content = ""
    const button = []
    let reply

    for (let i of msg) {
      if (typeof i == "object")
        i = { ...i }
      else
        i = { type: "text", text: i }

      switch (i.type) {
        case "record":
          i.type = "audio"
          i.file = await this.makeSilk(i.file)
        case "video":
          if (i.file) i.file = await Bot.fileToUrl(i.file)
          messages.push([i])
          break
        case "file":
          if (i.file) i.file = await Bot.fileToUrl(i.file, i)
          content += await this.makeRawMarkdownText(data, `文件：${i.file}`, button)
          break
        case "at":
          if (i.qq == "all")
            content += "@everyone"
          else
            content += `<@${i.qq.replace(`${data.self_id}${this.sep}`, "")}>`
          break
        case "text":
          content += await this.makeRawMarkdownText(data, i.text, button)
          break
        case "image": {
          const { des, url } = await this.makeMarkdownImage(i.file)
          content += `${des}${url}`
          break
        } case "markdown":
          content += i.data
          break
        case "button":
          button.push(...this.makeButtons(data, i.data))
          break
        case "face":
          break
        case "reply":
          reply = i
          continue
        case "node":
          for (const { message } of i.data)
            messages.push(...(await this.makeRawMarkdownMsg(data, message)))
          continue
        case "raw":
          messages.push([i.data])
          break
        default:
          content += await this.makeRawMarkdownText(data, JSON.stringify(i), button)
      }
    }

    if (content)
      messages.unshift([{ type: "markdown", content }])

    if (button.length) {
      for (const i of messages) {
        if (i[0].type == "markdown")
          i.push(...button.splice(0,5))
        if (!button.length) break
      }
      while (button.length) {
        messages.push([
          { type: "markdown", content: " " },
          ...button.splice(0,5),
        ])
      }
    }

    if (reply) for (const i in messages) {
      if (Array.isArray(messages[i]))
        messages[i].unshift(reply)
      else
        messages[i] = [reply, messages[i]]
    }
    return messages
  }

  makeMarkdownText(data, text, button) {
    const match = text.match(this.toQRCodeRegExp)
    if (match) for (const url of match) {
      button.push(...this.makeButtons(data, [[{ text: url, link: url }]]))
      text = text.replace(url, "[链接(请点击按钮查看)]")
    }
    return text.replace(/\n/g, "\r").replace(/@/g, "@​")
  }

  makeMarkdownTemplate(data, template) {
    const params = []
    for (const i of ["a", "b"])
    if (template[i]) params.push({ key: i, values: [template[i]] })
    return {
      type: "markdown",
      custom_template_id: config.markdown[data.self_id],
      params,
    }
  }

  async makeMarkdownMsg(data, msg) {
    if (!Array.isArray(msg))
      msg = [msg]
    const messages = []
    let content = ""
    let button = []
    let template = {}
    let reply

    for (let i of msg) {
      if (typeof i == "object")
        i = { ...i }
      else
        i = { type: "text", text: i }

      switch (i.type) {
        case "record":
          i.type = "audio"
          i.file = await this.makeSilk(i.file)
        case "video":
          if (i.file) i.file = await Bot.fileToUrl(i.file)
          messages.push([i])
          break
        case "file":
          if (i.file) i.file = await Bot.fileToUrl(i.file, i)
          button.push(...this.makeButtons(data, [[{ text: i.name || i.file, link: i.file }]]))
          content += "[文件(请点击按钮查看)]"
          break
        case "at":
          if (i.qq == "all")
            content += "@everyone"
          else
            content += `<@${i.qq.replace(`${data.self_id}${this.sep}`, "")}>`
          break
        case "text":
          content += this.makeMarkdownText(data, i.text, button)
          break
        case "image": {
          const { des, url } = await this.makeMarkdownImage(i.file)

          if (template.b) {
            template.b += content
            messages.push([this.makeMarkdownTemplate(data, template)])
            content = ""
            button = []
          }

          template = {
            a: content+des,
            b: url,
          }
          content = ""
          break
        } case "markdown":
          if (typeof i.data == "object")
            messages.push([{ type: "markdown", ...i.data }])
          else
            messages.push([{ type: "markdown", content: i.data }])
          break
        case "button":
          button.push(...this.makeButtons(data, i.data))
          break
        case "face":
          break
        case "reply":
          reply = i
          continue
        case "node":
          for (const { message } of i.data)
            messages.push(...(await this.makeMarkdownMsg(data, message)))
          continue
        case "raw":
          messages.push([i.data])
          break
        default:
          content += this.makeMarkdownText(data, JSON.stringify(i), button)
      }
    }

    if (template.b)
      template.b += content
    else if (content)
      template = { a: content }

    if (template.a)
      messages.push([this.makeMarkdownTemplate(data, template)])

    if (button.length) {
      for (const i of messages) {
        if (i[0].type == "markdown")
          i.push(...button.splice(0,5))
        if (!button.length) break
      }
      while (button.length) {
        messages.push([
          this.makeMarkdownTemplate(data, { a: " " }),
          ...button.splice(0,5),
        ])
      }
    }

    if (reply) for (const i of messages)
      i.unshift(reply)
    return messages
  }

  async makeMsg(data, msg) {
    if (!Array.isArray(msg))
      msg = [msg]
    const messages = []
    let message = []
    let reply
    for (let i of msg) {
      if (typeof i == "object")
        i = { ...i }
      else
        i = { type: "text", text: i }

      switch (i.type) {
        case "at":
          //i.user_id = i.qq.replace(`${data.self_id}${this.sep}`, "")
          continue
        case "text":
        case "face":
        case "ark":
        case "embed":
          break
        case "record":
          i.type = "audio"
          i.file = await this.makeSilk(i.file)
        case "video":
          if (i.file) i.file = await Bot.fileToUrl(i.file)
          if (message.length) {
            messages.push(message)
            message = []
          }
          break
        case "image":
          const image = await this.makeBotImage(i.file)
          i.file = image?.url || await Bot.fileToUrl(i.file)
          if (message.length) {
            messages.push(message)
            message = []
          }
          break
        case "file":
          if (i.file) i.file = await Bot.fileToUrl(i.file, i)
          i = { type: "text", text: `文件：${i.file}` }
          break
        case "reply":
          reply = i
          continue
        case "markdown":
          if (typeof i.data == "object")
            i = { type: "markdown", ...i.data }
          else
            i = { type: "markdown", content: i.data }
          break
        case "button":
          message.push(...this.makeButtons(data, i.data))
          continue
        case "node":
          for (const { message } of i.data)
            messages.push(...(await this.makeMsg(data, message)))
          continue
        case "raw":
          i = i.data
          break
        default:
          i = { type: "text", text: JSON.stringify(i) }
      }

      if (i.type == "text" && i.text) {
        const match = i.text.match(this.toQRCodeRegExp)
        if (match) for (const url of match) {
          const msg = segment.image(await Bot.fileToUrl(await this.makeQRCode(url)))
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

    if (message.length)
      messages.push(message)
    if (reply) for (const i of messages)
      i.unshift(reply)
    return messages
  }

  async sendMsg(data, send, msg) {
    const rets = { message_id: [], data: [] }
    let msgs

    const sendMsg = async () => { for (const i of msgs) try {
      Bot.makeLog("debug", ["发送消息", i], data.self_id)
      const ret = await send(i)
      Bot.makeLog("debug", ["发送消息返回", ret], data.self_id)

      rets.data.push(ret)
      if (ret.id)
        rets.message_id.push(ret.id)
    } catch (err) {
      Bot.makeLog("error", ["发送消息错误：", i, err], data.self_id)
      return false
    }}

    if (config.markdown[data.self_id]) {
      if (config.markdown[data.self_id] == "raw")
        msgs = await this.makeRawMarkdownMsg(data, msg)
      else
        msgs = await this.makeMarkdownMsg(data, msg)
    } else {
      msgs = await this.makeMsg(data, msg)
    }

    if (await sendMsg() === false) {
      msgs = await this.makeMsg(data, msg)
      await sendMsg()
    }

    if (Array.isArray(data._ret_id))
      data._ret_id.push(...rets.message_id)
    return rets
  }

  sendFriendMsg(data, msg, event) {
    Bot.makeLog("info", `发送好友消息：[${data.user_id}] ${Bot.String(msg)}`, data.self_id)
    return this.sendMsg(data, msg => data.bot.sdk.sendPrivateMessage(data.user_id, msg, event), msg)
  }

  sendGroupMsg(data, msg, event) {
    Bot.makeLog("info", `发送群消息：[${data.group_id}] ${Bot.String(msg)}`, data.self_id)
    return this.sendMsg(data, msg => data.bot.sdk.sendGroupMessage(data.group_id, msg, event), msg)
  }

  async makeGuildMsg(data, msg) {
    if (!Array.isArray(msg))
      msg = [msg]
    const messages = []
    let message = []
    let reply
    for (let i of msg) {
      if (typeof i == "object")
        i = { ...i }
      else
        i = { type: "text", text: i }

      switch (i.type) {
        case "at":
          i.user_id = i.qq.replace(/^qg_/, "")
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
          if (typeof i.data == "object")
            i = { type: "markdown", ...i.data }
          else
            i = { type: "markdown", content: i.data }
          break
        case "button":
          continue
        case "node":
          for (const { message } of i.data)
            messages.push(...(await this.makeGuildMsg(data, message)))
          continue
        case "raw":
          i = i.data
          break
        default:
          i = { type: "text", text: JSON.stringify(i) }
      }

      if (i.type == "text" && i.text) {
        const match = i.text.match(this.toQRCodeRegExp)
        if (match) for (const url of match) {
          const msg = segment.image(await this.makeQRCode(url))
          message.push(msg)
          messages.push(message)
          message = []
          i.text = i.text.replace(url, "[链接(请扫码查看)]")
        }
      }

      message.push(i)
    }

    if (message.length)
      messages.push(message)
    if (reply) for (const i of messages)
      i.unshift(reply)
    return messages
  }

  async sendGMsg(data, send, msg) {
    const rets = { message_id: [], data: [] }
    let msgs

    const sendMsg = async () => { for (const i of msgs) try {
      Bot.makeLog("debug", ["发送消息", i], data.self_id)
      const ret = await send(i)
      Bot.makeLog("debug", ["发送消息返回", ret], data.self_id)

      rets.data.push(ret)
      if (ret.id)
        rets.message_id.push(ret.id)
    } catch (err) {
      Bot.makeLog("error", ["发送消息错误：", i, err], data.self_id)
      return false
    }}

    msgs = await this.makeGuildMsg(data, msg)
    if (await sendMsg() === false) {
      msgs = await this.makeGuildMsg(data, msg)
      await sendMsg()
    }
    return rets
  }

  async sendDirectMsg(data, msg, event) {
    if (!data.guild_id) {
      if (!data.src_guild_id) {
        Bot.makeLog("error", `发送频道消息失败：[${data.user_id}] 不存在来源频道信息 ${Bot.String(msg)}`, data.self_id)
        return false
      }
      const dms = await data.bot.sdk.createDirectSession(data.src_guild_id, data.user_id)
      data.guild_id = dms.guild_id
      data.channel_id = dms.channel_id
    }
    Bot.makeLog("info", `发送频道私聊消息：[${data.guild_id}, ${data.user_id}] ${Bot.String(msg)}`, data.self_id)
    return this.sendGMsg(data, msg => data.bot.sdk.sendDirectMessage(data.guild_id, msg, event), msg)
  }

  sendGuildMsg(data, msg, event) {
    Bot.makeLog("info", `发送频道消息：[${data.guild_id}-${data.channel_id}] ${Bot.String(msg)}`, data.self_id)
    return this.sendGMsg(data, msg => data.bot.sdk.sendGuildMessage(data.channel_id, msg, event), msg)
  }

  pickFriend(id, user_id) {
    if (user_id.startsWith("qg_"))
      return this.pickGuildFriend(id, user_id)
    const i = {
      ...Bot[id].fl.get(user_id),
      self_id: id,
      bot: Bot[id],
      user_id: user_id.replace(`${id}${this.sep}`, ""),
    }
    return {
      ...i,
      sendMsg: msg => this.sendFriendMsg(i, msg),
      sendFile: (file, name) => this.sendFriendMsg(i, segment.file(file, name)),
    }
  }

  pickMember(id, group_id, user_id) {
    if (user_id.startsWith("qg_"))
      return this.pickGuildMember(id, group_id, user_id)
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
    if (group_id.startsWith("qg_"))
      return this.pickGuild(id, group_id)
    const i = {
      ...Bot[id].gl.get(group_id),
      self_id: id,
      bot: Bot[id],
      group_id: group_id.replace(`${id}${this.sep}`, ""),
    }
    return {
      ...i,
      sendMsg: msg => this.sendGroupMsg(i, msg),
      sendFile: (file, name) => this.sendGroupMsg(i, segment.file(file, name)),
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
      sendFile: (file, name) => this.sendDirectMsg(i, segment.file(file, name)),
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
      ...this.pickFriend(id, user_id),
      ...i,
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
      sendFile: (file, name) => this.sendGuildMsg(i, segment.file(file, name)),
      pickMember: user_id => this.pickGuildMember(id, group_id, user_id),
      getMemberMap: () => i.bot.gml.get(group_id),
    }
  }

  makeFriendMessage(data, event) {
    data.sender = {
      user_id: `${data.self_id}${this.sep}${event.sender.user_id}`,
    }
    Bot.makeLog("info", `好友消息：[${data.user_id}] ${data.raw_message}`, data.self_id)
    data.reply = msg => this.sendFriendMsg({
      ...data, user_id: event.sender.user_id,
    }, msg, { id: data.message_id })
  }

  makeGroupMessage(data, event) {
    data.sender = {
      user_id: `${data.self_id}${this.sep}${event.sender.user_id}`,
    }
    data.group_id = `${data.self_id}${this.sep}${event.group_id}`
    Bot.makeLog("info", `群消息：[${data.group_id}, ${data.user_id}] ${data.raw_message}`, data.self_id)
    data.reply = msg => this.sendGroupMsg({
      ...data, group_id: event.group_id,
    }, msg, { id: data.message_id })
  }

  makeDirectMessage(data, event) {
    data.sender = {
      ...data.bot.fl.get(`qg_${event.sender.user_id}`),
      ...event.sender,
      user_id: `qg_${event.sender.user_id}`,
      nickname: event.sender.user_name,
      avatar: event.author.avatar,
      guild_id: data.guild_id,
      channel_id: data.channel_id,
      src_guild_id: event.src_guild_id,
    }
    Bot.makeLog("info", `频道私聊消息：[${data.sender.nickname}(${data.user_id})] ${data.raw_message}`, data.self_id)
    data.reply = msg => this.sendDirectMsg({
      ...data,
      user_id: event.user_id,
      guild_id: event.guild_id,
      channel_id: event.channel_id,
    }, msg, { id: data.message_id })
  }

  makeGuildMessage(data, event) {
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
    Bot.makeLog("info", `频道消息：[${data.group_id}, ${data.sender.nickname}(${data.user_id})] ${data.raw_message}`, data.self_id)
    data.reply = msg => this.sendGuildMsg({
      ...data,
      guild_id: event.guild_id,
      channel_id: event.channel_id,
    }, msg, { id: data.message_id })
  }

  setListMap(data) {
    data.bot.fl.set(data.user_id, {
      ...data.bot.fl.get(data.user_id),
      ...data.sender,
    })
    if (data.group_id) {
      data.bot.gl.set(data.group_id, {
        ...data.bot.gl.get(data.group_id),
        group_id: data.group_id,
      })
      let gml = data.bot.gml.get(data.group_id)
      if (!gml) {
        gml = new Map
        data.bot.gml.set(data.group_id, gml)
      }
      gml.set(data.user_id, {
        ...gml.get(data.user_id),
        ...data.sender,
      })
    }
  }

  makeMessage(id, event) {
    const data = {
      raw: event,
      bot: Bot[id],
      self_id: id,
      post_type: event.post_type,
      message_type: event.message_type,
      sub_type: event.sub_type,
      message_id: event.message_id,
      get user_id() { return this.sender.user_id },
      message: event.message,
      raw_message: event.raw_message,
    }

    switch (data.message_type) {
      case "private":
        if (data.sub_type == "friend")
          this.makeFriendMessage(data, event)
        else
          this.makeDirectMessage(data, event)
        break
      case "group":
        this.makeGroupMessage(data, event)
        break
      case "guild":
        this.makeGuildMessage(data, event)
        break
      default:
        Bot.makeLog("warn", ["未知消息", event], id)
        return
    }

    this.setListMap(data)
    Bot.em(`${data.post_type}.${data.message_type}.${data.sub_type}`, data)
  }

  async makeBotCallback(id, event, callback) {
    const data = {
      raw: event,
      bot: Bot[callback.self_id],
      self_id: callback.self_id,
      post_type: "message",
      message_id: event.notice_id,
      message_type: callback.group_id ? "group" : "private",
      sub_type: "callback",
      get user_id() { return this.sender.user_id },
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
          ...await data.member.getInfo() || data.member,
        }
      } else {
        const real_id = callback.message.replace(/^#[Qq]+[Bb]ot绑定用户确认/, "").trim()
        if (this.bind_user[real_id] == data.user_id) {
          Bot[id].fl.set(data.user_id, {
            ...data.bot.fl.get(data.user_id),
            real_id,
          })
          event.reply(0)
          return data.group.sendMsg(`绑定成功 ${data.user_id} → ${real_id}`)
        }
        event.reply(1)
        return data.group.sendMsg(`请先发送 #QQBot绑定用户${data.user_id}`)
      }
      Bot.makeLog("info", [`群按钮点击事件：[${data.group_name}(${data.group_id}), ${data.sender.nickname}(${data.user_id})]`, data.raw_message], data.self_id)
    } else {
      Bot[id].fl.set(data.user_id, {
        ...data.bot.fl.get(data.user_id),
        real_id: callback.user_id,
      })
      data.friend = data.bot.pickFriend(callback.user_id)
      if (data.friend.getInfo)
        data.sender = await data.friend.getInfo()
      Bot.makeLog("info", [`好友按钮点击事件：[${data.sender.nickname}(${data.user_id})]`, data.raw_message], data.self_id)
    }

    event.reply(0)
    Bot.em(`${data.post_type}.${data.message_type}.${data.sub_type}`, data)
  }

  makeCallback(id, event) {
    const data = {
      raw: event,
      bot: Bot[id],
      self_id: id,
      post_type: "message",
      message_id: event.notice_id,
      message_type: event.notice_type,
      sub_type: "callback",
      get user_id() { return this.sender.user_id },
      sender: { user_id: `${id}${this.sep}${event.operator_id}` },
      message: [],
      raw_message: "",
    }

    const callback = data.bot.callback[event.data?.resolved?.button_id]
    if (callback) {
      if (callback.self_id)
        return this.makeBotCallback(id, event, callback)
      if (!event.group_id && callback.group_id)
        event.group_id = callback.group_id
      data.message_id = callback.id
      if (callback.message_id.length) {
        for (const id of callback.message_id)
          data.message.push({ type: "reply", id })
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
        data.reply = msg => this.sendFriendMsg({ ...data, user_id: event.operator_id }, msg, { id: data.message_id })
        break
      case "group":
        data.group_id = `${id}${this.sep}${event.group_id}`
        Bot.makeLog("info", [`群按钮点击事件：[${data.group_id}, ${data.user_id}]`, data.raw_message], data.self_id)
        data.reply = msg => this.sendGroupMsg({ ...data, group_id: event.group_id }, msg, { id: data.message_id })
        break
      case "guild":
        break
      default:
        Bot.makeLog("warn", ["未知按钮点击事件", event], data.self_id)
    }

    this.setListMap(data)
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

    if (Number(token[4]))
      opts.intents.push("GROUP_AT_MESSAGE_CREATE", "C2C_MESSAGE_CREATE")

    if (Number(token[5]))
      opts.intents.push("GUILD_MESSAGES")
    else
      opts.intents.push("PUBLIC_GUILD_MESSAGES")

    Bot[id] = {
      adapter: this,
      sdk: new QQBot(opts),
      login() { return this.sdk.start() },

      uin: id,
      info: { id },
      get nickname() { return this.sdk.nickname },
      get avatar() { return `https://q1.qlogo.cn/g?b=qq&s=0&nk=${this.uin}` },

      version: {
        id: this.id,
        name: this.name,
        version: this.version,
      },
      stat: { start_time: Date.now()/1000 },

      pickFriend: user_id => this.pickFriend(id, user_id),
      get pickUser() { return this.pickFriend },
      getFriendMap() { return this.fl },
      fl: this.getFriendMap(id),

      pickMember: (group_id, user_id) => this.pickMember(id, group_id, user_id),
      pickGroup: group_id => this.pickGroup(id, group_id),
      getGroupMap() { return this.gl },
      gl: this.getGroupMap(id),
      gml: this.getMemberMap(id),

      callback: {},
    }

    await Bot[id].login()

    Bot[id].sdk.logger = {}
    for (const i of ["trace", "debug", "info", "mark", "warn", "error", "fatal"])
      Bot[id].sdk.logger[i] = (...args) => Bot.makeLog(i, args, id)

    Bot[id].sdk.on("message", event => this.makeMessage(id, event))
    Bot[id].sdk.on("notice", event => this.makeNotice(id, event))

    logger.mark(`${logger.blue(`[${id}]`)} ${this.name}(${this.id}) ${this.version} 已连接`)
    Bot.em(`connect.${id}`, { self_id: id })
    return true
  }

  async load() {
    for (const token of config.token)
      await new Promise(resolve => {
        adapter.connect(token).then(resolve)
        setTimeout(resolve, 5000)
      })
  }
}

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
          reg: "^#[Qq]+[Bb]ot设置[0-9]+:[0-9]+:.+:.+:[01]:[01]$",
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
        }
      ]
    })
  }

  List() {
    this.reply(`共${config.token.length}个账号：\n${config.token.join("\n")}`, true)
  }

  async Token() {
    const token = this.e.msg.replace(/^#[Qq]+[Bb]ot设置/, "").trim()
    if (config.token.includes(token)) {
      config.token = config.token.filter(item => item != token)
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
    configSave(config)
  }

  Markdown() {
    let token = this.e.msg.replace(/^#[Qq]+[Bb]ot[Mm](ark)?[Dd](own)?/, "").trim().split(":")
    const bot_id = token.shift()
    token = token.join(":")
    this.reply(`Bot ${bot_id} Markdown 模板已设置为 ${token}`, true)
    config.markdown[bot_id] = token
    configSave(config)
  }

  BindUser() {
    const id = this.e.msg.replace(/^#[Qq]+[Bb]ot绑定用户/, "").trim()
    if (id == this.e.user_id)
      return this.reply("请切换到对应Bot")

    adapter.bind_user[this.e.user_id] = id
    this.reply([
      `绑定 ${id} → ${this.e.user_id}`,
      segment.button([{
        text: "确认绑定",
        callback: `#QQBot绑定用户确认${this.e.user_id}`,
        permission: this.e.user_id
      }])
    ])
  }
}

logger.info(logger.green("- QQBot 适配器插件 加载完成"))