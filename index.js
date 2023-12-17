logger.info(logger.yellow("- 正在加载 QQBot 适配器插件"))

import { config, configSave } from "./Model/config.js"
import fs from "node:fs"
import path from "node:path"
import QRCode from "qrcode"
import imageSize from "image-size"
import { randomUUID } from "crypto"
import { encode as encodeSilk } from "silk-wasm"
import { Bot as QQBot } from "qq-group-bot"

const adapter = new class QQBotAdapter {
  constructor() {
    this.id = "QQBot"
    this.name = "QQBot"
    this.version = `qq-group-bot ${config.package.dependencies["qq-group-bot"].replace("^", "v")}`

    if (typeof config.toQRCode == "boolean")
      this.toQRCodeRegExp = config.toQRCode ? /https?:\/\/[\w\-_]+(\.[\w\-_]+)+([\w\-\.,@?^=%&:/~\+#]*[\w\-\@?^=%&/~\+#])?/g : false
    else
      this.toQRCodeRegExp = new RegExp(config.toQRCode, "g")
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

  async makeRawMarkdownText(data) {
    const match = data.match(this.toQRCodeRegExp)
    if (match) for (const url of match) {
      const img = await this.makeImage(await this.makeQRCode(url))
      data = data.replace(url, `![${img.dec}](${img.url})`)
    }
    return data
  }

  async makeImage(file) {
    const buffer = await Bot.Buffer(file)
    if (!Buffer.isBuffer(buffer)) return {}

    let url
    if (file.match?.(/^https?:\/\//)) url = file
    else url = await Bot.fileToUrl(buffer)

    const size = imageSize(buffer)
    return { dec: `图片 #${size.width}px #${size.height}px`, url }
  }

  makeButton(data, button) {
    const msg = {
      id: String(Date.now()),
      render_data: {
        label: button.text,
        visited_label: button.clicked_text,
        style: 1,
        ...button.render_data,
      }
    }

    if (button.input)
      msg.action = {
        type: 2,
        permission: { type: 2 },
        data: button.input,
        enter: button.send,
        ...button.action,
      }
    else if (button.link)
      msg.action = {
        type: 0,
        permission: { type: 2 },
        data: button.link,
        ...button.action,
      }

    if (button.permission) {
      if (button.permission == "admin") {
        msg.action.permission.type = 1
      } else {
        msg.action.permission.type = 0
        msg.action.permission.specify_user_ids = []
        if (!Array.isArray(button.permission))
          button.permission = [button.permission]
        for (const id of button.permission)
          msg.action.permission.specify_user_ids.push(id.replace(`${data.self_id}:`, ""))
      }
    }
    return msg
  }

  makeButtons(data, button_square) {
    const msgs = []
    for (const button_row of button_square) {
      const buttons = []
      for (const button of button_row)
        buttons.push(this.makeButton(data, button))
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
        case "file":
          if (i.file) i.file = await Bot.fileToUrl(i.file)
          messages.push(i)
          break
        case "at":
          if (i.qq == "all")
            content += "@everyone"
          else
            content += `<@${i.qq.replace(`${data.self_id}:`, "")}>`
          break
        case "text":
          content += await this.makeRawMarkdownText(i.text)
          break
        case "image": {
          const { dec, url } = await this.makeImage(i.file)
          content += `![${dec}](${url})`
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
          messages.push(i.data)
          break
        default:
          content += await this.makeRawMarkdownText(JSON.stringify(i))
      }
    }

    if (content)
      messages.unshift([{ type: "markdown", content }, ...button])
    if (reply) for (const i of messages)
      i.unshift(reply)
    return messages
  }

  makeMarkdownTemplate(data, template) {
    const params = []
    for (const i of ["text_start", "img_dec", "img_url", "text_end"])
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
        case "file":
          if (i.file) i.file = await Bot.fileToUrl(i.file)
          messages.push(i)
          break
        case "at":
          if (i.qq == "all")
            content += "@everyone"
          else
            content += `<@${i.qq.replace(`${data.self_id}:`, "")}>`
          break
        case "text":
          content += i.text
          break
        case "image": {
          const { dec, url } = await this.makeImage(i.file)

          if (template.img_dec && template.img_url) {
            template.text_end = content
            messages.push([
              this.makeMarkdownTemplate(data, template),
              ...button,
            ])
            content = ""
            button = []
          }

          template = {
            text_start: content,
            img_dec: dec,
            img_url: url,
          }
          content = ""
          break
        } case "markdown":
          if (typeof i.data == "object")
            messages.push({ type: "markdown", ...i.data })
          else
            messages.push({ type: "markdown", content: i.data })
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
          messages.push(i.data)
          break
        default:
          content += await this.makeRawMarkdownText(JSON.stringify(i))
      }

      if (content) {
        content = content.replace(/\n/g, "\r")
        const match = content.match(this.toQRCodeRegExp)
        if (match) for (const url of match) {
          const msg = segment.image(await Bot.fileToUrl(await this.makeQRCode(url)))
          messages.push(msg)
          content = content.replace(url, "[链接(请扫码查看)]")
        }
      }
    }

    if (template.img_dec && template.img_url) {
      template.text_end = content
    } else if (content) {
      template = { text_start: content, text_end: "" }
    }
    if (template.text_start || template.text_end || (template.img_dec && template.img_url))
      messages.push([
        this.makeMarkdownTemplate(data, template),
        ...button,
      ])
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
          //i.user_id = i.qq.replace(`${data.self_id}:`, "")
          continue
        case "text":
        case "face":
        case "ark":
        case "embed":
          break
        case "record":
          i.type = "audio"
          i.file = await this.makeSilk(i.file)
        case "image":
        case "video":
        case "file":
          if (i.file)
            i.file = await Bot.fileToUrl(i.file)
          if (message.length) {
            messages.push(message)
            message = []
          }
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
          i = { type: "text", data: { text: JSON.stringify(i) }}
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
    if (config.markdown[data.self_id]) {
      if (config.markdown[data.self_id] == "raw") {
        msgs = await this.makeRawMarkdownMsg(data, msg)
      } else {
        /*let needMd = false
        if (Array.isArray(msg)) for (const i of msg)
          if (typeof i == "object" && i.type == "button") {
            needMd = true
            break
          }
        if (needMd)*/
          msgs = await this.makeMarkdownMsg(data, msg)
        /*else
          msgs = await this.makeMsg(data, msg)*/
      }
    } else {
      msgs = await this.makeMsg(data, msg)
    }

    for (const i of msgs) try {
      const ret = await send(i)
      if (ret) {
        rets.data.push(ret)
        if (ret.msg_id || ret.sendResult?.msg_id)
          rets.message_id.push(ret.msg_id || ret.sendResult.msg_id)
      }
    } catch (err) {
      Bot.makeLog("error", `发送消息错误：${Bot.String(msg)}`)
      logger.error(err)
    }
    return rets
  }

  sendReplyMsg(data, msg, event) {
    Bot.makeLog("info", `发送回复消息：[${data.group_id ? `${data.group_id}, ` : ""}${data.user_id}] ${Bot.String(msg)}`, data.self_id)
    return this.sendMsg(data, msg => event.reply(msg), msg)
  }

  sendFriendMsg(data, msg, event) {
    Bot.makeLog("info", `发送好友消息：[${data.user_id}] ${Bot.String(msg)}`, data.self_id)
    return this.sendMsg(data, msg => data.bot.sdk.sendPrivateMessage(data.user_id, msg, event), msg)
  }

  sendGroupMsg(data, msg, event) {
    Bot.makeLog("info", `发送群消息：[${data.group_id}] ${Bot.String(msg)}`, data.self_id)
    return this.sendMsg(data, msg => data.bot.sdk.sendGroupMessage(data.group_id, msg, event), msg)
  }

  pickFriend(id, user_id) {
    const i = {
      ...Bot[id].fl.get(user_id),
      self_id: id,
      bot: Bot[id],
      user_id: user_id.replace(`${id}:`, ""),
    }
    return {
      ...i,
      sendMsg: msg => this.sendFriendMsg(i, msg),
      sendFile: (file, name) => this.sendFriendMsg(i, segment.file(file, name)),
    }
  }

  pickMember(id, group_id, user_id) {
    const i = {
      ...Bot[id].fl.get(user_id),
      self_id: id,
      bot: Bot[id],
      user_id: user_id.replace(`${id}:`, ""),
      group_id: group_id.replace(`${id}:`, ""),
    }
    return {
      ...this.pickFriend(id, user_id),
      ...i,
    }
  }

  pickGroup(id, group_id) {
    const i = {
      ...Bot[id].gl.get(group_id),
      self_id: id,
      bot: Bot[id],
      group_id: group_id.replace(`${id}:`, ""),
    }
    return {
      ...i,
      sendMsg: msg => this.sendGroupMsg(i, msg),
      sendFile: (file, name) => this.sendGroupMsg(i, segment.file(file, name)),
      pickMember: user_id => this.pickMember(id, group_id, user_id),
    }
  }

  makeMessage(id, event) {
    const data = {
      event,
      bot: Bot[id],
      self_id: id,
      post_type: event.post_type,
      message_id: event.message_id,
      user_id: `${id}:${event.user_id}`,
      group_id: `${id}:${event.group_id}`,
      sender: {
        user_id: `${id}:${event.sender.user_id}`,
        user_openid: `${id}:${event.sender.user_openid}`
      },
      message: event.message,
      raw_message: event.raw_message,
    }
    data.bot.fl.set(data.user_id, data.sender)

    return data
  }

  makeFriendMessage(id, event) {
    const data = this.makeMessage(id, event)
    data.message_type = "private"
    delete data.group_id

    Bot.makeLog("info", `好友消息：[${data.user_id}] ${data.raw_message}`, data.self_id)
    Bot.em(`${data.post_type}.${data.message_type}`, data)
  }

  makeGroupMessage(id, event) {
    const data = this.makeMessage(id, event)
    data.message_type = "group"
    data.bot.gl.set(data.group_id, {
      group_id: data.group_id,
      group_openid: data.event.group_openid,
    })
    data.reply = msg => this.sendReplyMsg(data, msg, event)

    Bot.makeLog("info", `群消息：[${data.group_id}, ${data.user_id}] ${data.raw_message}`, data.self_id)
    Bot.em(`${data.post_type}.${data.message_type}`, data)
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
      fl: new Map,

      pickMember: (group_id, user_id) => this.pickMember(id, group_id, user_id),
      pickGroup: group_id => this.pickGroup(id, group_id),
      getGroupMap() { return this.gl },
      gl: new Map,
      gml: new Map,
    }

    await Bot[id].login()

    Bot[id].sdk.logger = {
      trace: log => logger.trace(`${logger.blue(`[${id}]`)} ${log}`),
      debug: log => logger.debug(`${logger.blue(`[${id}]`)} ${log}`),
      info: log => logger.info(`${logger.blue(`[${id}]`)} ${log}`),
      mark: log => logger.mark(`${logger.blue(`[${id}]`)} ${log}`),
      warn: log => logger.warn(`${logger.blue(`[${id}]`)} ${log}`),
      error: log => logger.error(`${logger.blue(`[${id}]`)} ${log}`),
      fatal: log => logger.fatal(`${logger.blue(`[${id}]`)} ${log}`),
    }

    Bot[id].sdk.on("message.private", event => this.makeFriendMessage(id, event))
    Bot[id].sdk.on("message.group", event => this.makeGroupMessage(id, event))

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
}

logger.info(logger.green("- QQBot 适配器插件 加载完成"))