logger.info(logger.yellow("- 正在加载 QQBot 适配器插件"))

import { config, configSave } from "./Model/config.js"
import fs from "node:fs"
import path from "node:path"
import QRCode from "qrcode"
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
      file = Buffer.from(await encodeSilk(fs.readFileSync(pcmFile), 48000))
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

  async sendMsg(data, send, msg) {
    if (!Array.isArray(msg))
      msg = [msg]
    const msgs = []
    const sendMsg = async msg => {
      try {
        msgs.push(await send(msg))
      } catch (err) {
        Bot.makeLog("error", `发送消息错误：${Bot.String(msg)}`)
        logger.error(err)
      }
    }

    let messages = []
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
        case "reply":
        case "markdown":
        case "button":
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
          if (messages.length) {
            await sendMsg(messages)
            messages = []
          }
          break
        case "node":
          msgs.push(...(await Bot.sendForwardMsg(msg => this.sendMsg(data, send, msg), i.data)))
          continue
        default:
          i = { type: "text", data: { text: JSON.stringify(i) }}
      }

      if (i.type == "text" && i.text) {
        const match = i.text.match(this.toQRCodeRegExp)
        if (match) for (const url of match) {
          msgs.push(...(await this.sendMsg(data, send, segment.image(await this.makeQRCode(url)))))
          i.text = i.text.replace(url, "[链接(请扫码查看)]")
        }
      }

      messages.push(i)
    }

    if (messages.length)
      await sendMsg(messages)
    return msgs
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
}

logger.info(logger.green("- QQBot 适配器插件 加载完成"))