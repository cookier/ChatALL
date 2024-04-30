import AsyncLock from "async-lock";
import Bot from "./Bot";
import axios from "axios";
import store from "@/store";
import { SSE } from "sse.js";
import i18n from "@/i18n";

export default class JuLianGPTBot extends Bot {
  static _brandId = "julianGPT"; // Brand id of the bot, should be unique. Used in i18n.
  static _className = "JuLianGPTBot"; // Class name of the bot
  static _logoFilename = "julian-logo.png"; // Place it in public/bots/
  static _loginUrl = "https://chat.julianwl.com/";
  static _lock = new AsyncLock(); // AsyncLock for prompt requests

  constructor() {
    super();
  }

  getAuthHeader() {
    return {
      headers: {
        Authorization: `Bearer ${store.state.julianGPT?.authorization}`,
      },
    };
  }

  /**
   * Check whether the bot is logged in, settings are correct, etc.
   * @returns {boolean} - true if the bot is available, false otherwise.
   */
  async _checkAvailability() {
    // Check:
    // 1. Whether the bot is logged in as needed
    // 2. Whether the bot settings are correct (e.g. API key is valid)
    // If yes:
    //   return true;
    // else:
    //   return false;

    let available = false;
    try {
      if (store.state.julianGPT.authorization) {
        await this.getAuthInfo();
        available = true;
        console.log("julian is ok");
      }
    } catch (e) {
      available = false;
      console.error("Error checking julian auth token status:", e);
    }
    return available;
  }

  async getAuthInfo() {
    console.log(store.state.julianGPT.authorization);
    let infoUrl = "https://chat.julianwl.com/api/auth/getInfo";
    return await axios
      .get(infoUrl, {
        headers: {
          Authorization: `Bearer ${store.state.julianGPT.authorization}`,
        },
      })
      .then((response) => {
        console.log("julian auth token is valid, header:\n" + response.headers);
      });
  }

  /**
   * Send a prompt to the bot and call onResponse(response, callbackParam)
   * when the response is ready.
   * @param {string} prompt
   * @param {function} onUpdateResponse params: callbackParam, Object {content, done}
   * @param {object} callbackParam - Just pass it to onUpdateResponse() as is
   */
  async _sendPrompt(prompt, onUpdateResponse, callbackParam) {
    let context = await this.getChatContext();

    return new Promise((resolve, reject) => {
      const headers = this.getAuthHeader().headers;
      headers["Content-Type"] = "application/json";
      try {
        const source = new SSE(
          `https://chat.julianwl.com/api/chatgpt/chat-process`,
          {
            headers,
            payload: JSON.stringify({
              appId: null,
              options: {
                groupId: context.chat,
                model: 3,
                temperature: 0.8,
                usingNetwork: false,
              },
              prompt: prompt,
              systemMessage: "",
            }),
            withCredentials: true,
          },
        );
        let text = "";
        source.addEventListener("completion", (event) => {
          try {
            console.log("--------------------" + event);
            const data = JSON.parse(event.data);
            if (data.completion) {
              text += data.completion;
              onUpdateResponse(callbackParam, {
                content: text,
                done: false,
              });
            }
          } catch (error) {
            console.error(event);
            reject(this.getSSEDisplayError(event));
          }
        });
        source.addEventListener("readystatechange", (event) => {
          console.log(
            source.CLOSED + "++++++++++++++++++++++" + JSON.stringify(event),
          );

          if (event.readyState === source.CLOSED) {
            // after stream closed, done
            onUpdateResponse(callbackParam, {
              content: text,
              done: true,
            });
            resolve();
          }
        });
        source.addEventListener("error", (event) => {
          console.error(event);
          reject(this.getSSEDisplayError(event));
        });

        let beginning = "";
        let body = "";
        source.addEventListener("message", (event) => {
          console.log("EVENT=====" + JSON.stringify(event));
          console.log("DATA=====" + event.data);
          if (!event.data) {
            return;
          }
          const data = JSON.parse(event.data);
          if (data.event === "search_plus") {
            if (data.msg?.type == "start_res")
              beginning += `> ${i18n.global.t("kimi.searching")}\n`;
            else if (data.msg?.type === "get_res")
              beginning += `> ${i18n.global.t("kimi.found", { num: data.msg.successNum })}[${data.msg.title}](${data.msg.url})\n`;
          } else if (data.event === "cmpl") {
            body += data.text;
          }

          if (data.event === "all_done") {
            onUpdateResponse(callbackParam, {
              content: `${beginning}\n${body}`,
              done: true,
            });
            resolve();
          } else {
            onUpdateResponse(callbackParam, {
              content: `${beginning}\n${body}`,
              done: false,
            });
          }
        });
        source.stream();
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Should implement this method if the bot supports conversation.
   * The conversation structure is defined by the subclass.
   * @param null
   * @returns {any} - Conversation structure. null if not supported.
   */
  async createChatContext() {
    let context = null;
    await axios
      .post(
        "https://chat.julianwl.com/api/group/create",
        {
          appId: 0,
        },
        this.getAuthHeader(),
      )
      .then((response) => {
        console.log("创建新的聊天：" + JSON.stringify(response.data));
        context = {
          chat: response.data?.data.id,
        };
      })
      .catch((error) => {
        console.error("Error JuLianGPT createChatContext ", error);
      });
    return context;
  }
}
