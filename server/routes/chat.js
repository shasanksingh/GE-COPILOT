import { Router } from "express";
import dotnet from "dotenv";
import user from "../helpers/user.js";
import jwt from "jsonwebtoken";
import chat from "../helpers/chat.js";
import OpenAI, { toFile } from "openai";
import { db } from "../db/connection.js";
import collections from "../db/collections.js";
import multer from "multer";
import fs from "fs";
import { ObjectId } from "mongodb";
dotnet.config();

let router = Router();
const upload = multer({ dest: "uploads/" });

// Middleware to check if user is logged in
const CheckUser = async (req, res, next) => {
  jwt.verify(
    req.cookies?.userToken,
    process.env.JWT_PRIVATE_KEY,
    async (err, decoded) => {
      if (decoded) {
        let userData = null;
        try {
          userData = await user.checkUserFound(decoded);
        } catch (err) {
          if (err?.notExists) {
            res.clearCookie("userToken").status(405).json({
              status: 405,
              message: err?.text,
            });
          } else {
            res.status(500).json({
              status: 500,
              message: err,
            });
          }
        } finally {
          if (userData) {
            req.body.userId = userData._id;
            next();
          }
        }
      } else {
        res.status(405).json({
          status: 405,
          message: "Not Logged",
        });
      }
    }
  );
};

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Root route to confirm the API is working
router.get("/", (req, res) => {
  res.send("Welcome to chatGPT API v1");
});

// Route to get the file name of a chat
router.get("/upload", CheckUser, async (req, res) => {
  const { userId } = req.body;
  const { chatId } = req.query;
  let chat = await db.collection(collections.CHAT).findOne({
    user: userId.toString(),
    "data.chatId": chatId,
  });
  if (chat) {
    chat = chat.data.filter((obj) => {
      return obj.chatId === chatId;
    });
    chat = chat[0];
    res.status(200).json({
      status: 200,
      message: "Success",
      data: chat.file_name,
    });
  } else {
    res.status(404).json({
      status: 404,
      message: "Not found",
    });
  }
});

// Route to upload a file and link it to a chat
router.post("/upload", upload.single("file"), CheckUser, async (req, res) => {
  const { userId, chatId } = req.body;
  const file = fs.createReadStream(req ? req.file.path : null);
  let response = null;
  try {
    response = await client.files.create({
      purpose: "assistants",
      file: file,
    });
  } catch (err) {
    console.log(err);
    res.status(500).json({
      status: 500,
      message: err,
    });
    return;
  }

  let file_id = null;
  let file_name = null;

  if (response) {
    file_id = response.id;
    file_name = req.file.originalname;

    let chatIdToSend = null;

    const chat = await db
      .collection(collections.CHAT)
      .aggregate([
        {
          $match: {
            user: userId.toString(),
          },
        },
        {
          $unwind: "$data",
        },
        {
          $match: {
            "data.chatId": chatId,
          },
        },
        {
          $project: {
            files: "$data.files",
          },
        },
      ])
      .toArray();

    let all_files = [];
    if (chat[0]?.files?.length > 0) {
      all_files = [...chat[0].files, file_id];
    } else {
      all_files = [file_id];
    }

    const assistant = await client.beta.assistants.create({
      name: "GE CoPilot",
      instructions:
        "You are a helpful and that answers what is asked. Retrieve the relevant information from the files.",
      tools: [{ type: "retrieval" }, { type: "code_interpreter" }],
      model: "gpt-4-0125-preview",
      file_ids: all_files,
    });

    if (chat.length > 0) {
      chatIdToSend = chatId;
      await db.collection(collections.CHAT).updateOne(
        {
          user: userId.toString(),
          "data.chatId": chatId,
        },
        {
          $addToSet: {
            "data.$.files": file_id,
            "data.$.file_name": file_name,
          },
          $set: {
            "data.$.assistant_id": assistant.id,
          },
        }
      );
    } else {
      const newChatId = new ObjectId().toHexString();
      chatIdToSend = newChatId;
      await db.collection(collections.CHAT).updateOne(
        {
          user: userId.toString(),
        },
        {
          $push: {
            data: {
              chatId: newChatId,
              files: [file_id],
              file_name: [file_name],
              chats: [],
              chat: [],
              assistant_id: assistant.id,
            },
          },
        },
        {
          new: true,
          upsert: true,
        }
      );
    }

    res.status(200).json({
      status: 200,
      message: "Success",
      data: {
        file_id,
        file_name,
        chatId: chatIdToSend,
      },
    });
  }
});

// Route to create a new chat without files
router.post("/", CheckUser, async (req, res) => {
  const { prompt, userId } = req.body;
  let response = {};
  try {
    response.openai = await openai.chat.completions.create({
      model: "gpt-4-0125-preview",
      messages: [
        {
          role: "system",
          content:
            "You are a helpful and that answers what is asked. Dont show the mathematical steps if not asked.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      top_p: 0.5,
    });

    if (response.openai.choices[0].message) {
      response.openai = response.openai.choices[0].message.content;
      response.db = await chat.newResponse(prompt, response, userId);
    }
  } catch (err) {
    console.log(err);
    res.status(500).json({
      status: 500,
      message: err,
    });
  } finally {
    if (response?.db && response?.openai) {
      res.status(200).json({
        status: 200,
        message: "Success",
        data: {
          _id: response.db["chatId"],
          content: response.openai,
        },
      });
    }
  }
});

// Route to continue an existing chat
router.put("/", CheckUser, async (req, res) => {
  const { prompt, userId, chatId } = req.body;
  let mes = {
    role: "system",
    content:
      "You are a helpful and that answers what is asked. Dont show the mathematical steps if not asked.",
  };
  let full = "";
  let message = await chat.Messages(userId, chatId);
  message = message[0].chats;
  mes = [mes, ...message];
  mes = [
    ...mes,
    {
      role: "user",
      content: prompt,
    },
  ];
  let response = {};
  let new_chat = await db.collection(collections.CHAT).findOne({
    user: userId.toString(),
    data: { $elemMatch: { chatId: chatId } },
  });
  new_chat = new_chat.data.filter((obj) => {
    return obj.chatId === chatId;
  });
  new_chat = new_chat[0];
  const assistant_id = new_chat.assistant_id;
  try {
    if (assistant_id) {
      const thread = await client.beta.threads.create({
        messages: [
          {
            role: "user",
            content: prompt,
          },
        ],
      });
      const run = await client.beta.threads.runs.create(thread.id, {
        assistant_id: assistant_id,
      });
      let final_run = "";
      while (final_run.status !== "completed") {
        final_run = await client.beta.threads.runs.retrieve(thread.id, run.id);
      }
      const messages = await client.beta.threads.messages.list(thread.id);
      response = { openai: messages.data[0].content[0].text.value };
      if (response.openai) {
        response.db = await chat.Response(
          prompt,
          response,
          userId,
          chatId,
          assistant_id
        );
      }
    } else {
      response.openai = await openai.chat.completions.create({
        model: "gpt-4-0125-preview",
        messages: mes,
        top_p: 0.52,
        stream: true,
      });
      for await (const part of response.openai) {
        let text = part.choices[0].delta.content ?? "";
        full += text;
      }
      response.openai = {
        role: "assistant",
        content: full,
      };
      if (response.openai) {
        response.db = await chat.Response(
          prompt,
          response,
          userId,
          chatId,
          assistant_id
        );
      }
    }
  } catch (err) {
    console.log(err);
    res.status(500).json({
      status: 500,
      message: err,
    });
  } finally {
    if (response?.db && response?.openai) {
      res.status(200).json({
        status: 200,
        message: "Success",
        data: {
          content: response.openai.content,
        },
      });
    }
  }
});

export default router;
