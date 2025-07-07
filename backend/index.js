require("dotenv").config();
const fs = require("fs");
const express = require("express");
const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  WebhookClient,
} = require("discord.js");

const app = express(); // Настройка Express
const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel],
});

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

// Зарегистрированная команда /embed
const commands = [
  new SlashCommandBuilder()
    .setName("embed")
    .setDescription("Создать и отправить embed-сообщение"),
].map((c) => c.toJSON());

// Хранение сессий пользователей
const userSessions = new Map();

// Функция для сохранения сессий
const saveSessions = () => {
  const sessionsToSave = {};
  for (const [userId, session] of userSessions.entries()) {
    sessionsToSave[userId] = {
      embeds: session.embeds.map((embed) => embed.toJSON()),
      content: session.content || "",
      attachment: session.attachment || "",
    };
  }
  fs.writeFileSync("./sessions.json", JSON.stringify(sessionsToSave, null, 2));
};

// Загрузка сохраненных сессий
const loadSessions = () => {
  try {
    if (fs.existsSync("./sessions.json")) {
      const savedSessions = JSON.parse(
        fs.readFileSync("./sessions.json", "utf8"),
      );
      for (const [userId, session] of Object.entries(savedSessions)) {
        const embeds = session.embeds.map((embedData) => {
          // Очистка полей с пустыми значениями
          if (embedData.fields) {
            embedData.fields = embedData.fields.filter(
              (f) => f.name && f.value,
            );
          }
          return EmbedBuilder.from(embedData);
        });
        userSessions.set(userId, {
          embeds,
          content: session.content || "",
          attachment: session.attachment || "",
        });
      }
    }
  } catch (error) {
    console.error("Ошибка загрузки сессий:", error);
  }
};

// Логирование действий админов
const logAdmin = (msg) => {
  const timestamp = new Date().toISOString();
  fs.appendFileSync("./admin-log.txt", `${timestamp} | ${msg}\n`);
};

// Создание главного меню
const createMainMenu = () => {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("add_embed")
      .setLabel("➕ Добавить embed")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("edit_embed")
      .setLabel("✏️ Редактировать embed")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("delete_embed")
      .setLabel("🗑 Удалить embed")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId("set_content")
      .setLabel("📝 Текст сообщения")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("preview_send")
      .setLabel("📤 Предпросмотр и отправка")
      .setStyle(ButtonStyle.Success),
  );
};

// Инициализация бота
client.once("ready", async () => {
  console.log(`🤖 Бот запущен как ${client.user.tag}`);
  loadSessions();

  try {
    // Очистка старых команд
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
      body: [],
    });
    console.log("🧹 Старые команды очищены");

    // Регистрация новых команд
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
      body: commands,
    });
    console.log("✅ Команды зарегистрированы успешно");
  } catch (error) {
    console.error("❌ Ошибка регистрации команд:", error);
  }
});

// Обработка взаимодействий
client.on("interactionCreate", async (interaction) => {
  try {
    const userId = interaction.user.id;

    if (
      interaction.isChatInputCommand() &&
      interaction.commandName === "embed"
    ) {
      // Проверка прав администратора
      if (!interaction.member.permissions.has("Administrator")) {
        return await interaction.reply({
          content: "❌ Только администратор может использовать эту команду.",
          ephemeral: true,
        });
      }

      // Инициализация сессии пользователя
      if (!userSessions.has(userId)) {
        userSessions.set(userId, { embeds: [], content: "", attachment: "" });
      }

      const session = userSessions.get(userId);
      const embedCount = session.embeds.length;

      return await interaction.reply({
        content: `🔧 **Управление embed-сообщением**\n📊 Создано embeds: ${embedCount}`,
        components: [createMainMenu()],
        ephemeral: true,
      });
    }

    // Обработка кнопок
    if (interaction.isButton()) {
      const session = userSessions.get(userId) || {
        embeds: [],
        content: "",
        attachment: "",
      };

      switch (interaction.customId) {
        case "add_embed":
          const modal = new ModalBuilder()
            .setCustomId("embed_modal")
            .setTitle("Создание нового embed");

          const titleInput = new TextInputBuilder()
            .setCustomId("embed_title")
            .setLabel("Заголовок embed")
            .setStyle(TextInputStyle.Short)
            .setRequired(false);

          const descInput = new TextInputBuilder()
            .setCustomId("embed_description")
            .setLabel("Описание embed")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false);

          const colorInput = new TextInputBuilder()
            .setCustomId("embed_color")
            .setLabel("Цвет (hex, например #ff0000)")
            .setStyle(TextInputStyle.Short)
            .setRequired(false);

          const imageInput = new TextInputBuilder()
            .setCustomId("embed_image")
            .setLabel("Ссылка на изображение")
            .setStyle(TextInputStyle.Short)
            .setRequired(false);

          modal.addComponents(
            new ActionRowBuilder().addComponents(titleInput),
            new ActionRowBuilder().addComponents(descInput),
            new ActionRowBuilder().addComponents(colorInput),
            new ActionRowBuilder().addComponents(imageInput),
          );

          return await interaction.showModal(modal);

        case "edit_embed":
          if (session.embeds.length === 0) {
            return await interaction.reply({
              content: "❌ Нет embeds для редактирования.",
              ephemeral: true,
            });
          }

          const editSelect = new StringSelectMenuBuilder()
            .setCustomId("select_edit_embed")
            .setPlaceholder("Выберите embed для редактирования")
            .addOptions(
              session.embeds.map((embed, index) => ({
                label: embed.data.title || `Embed ${index + 1}`,
                description: embed.data.description
                  ? embed.data.description.substring(0, 50) + "..."
                  : "Без описания",
                value: index.toString(),
              })),
            );

          return await interaction.reply({
            content: "✏️ Выберите embed для редактирования:",
            components: [new ActionRowBuilder().addComponents(editSelect)],
            ephemeral: true,
          });

        case "delete_embed":
          if (session.embeds.length === 0) {
            return await interaction.reply({
              content: "❌ Нет embeds для удаления.",
              ephemeral: true,
            });
          }

          const deleteSelect = new StringSelectMenuBuilder()
            .setCustomId("select_delete_embed")
            .setPlaceholder("Выберите embed для удаления")
            .addOptions(
              session.embeds.map((embed, index) => ({
                label: embed.data.title || `Embed ${index + 1}`,
                description: embed.data.description
                  ? embed.data.description.substring(0, 50) + "..."
                  : "Без описания",
                value: index.toString(),
              })),
            );

          return await interaction.reply({
            content: "🗑 Выберите embed для удаления:",
            components: [new ActionRowBuilder().addComponents(deleteSelect)],
            ephemeral: true,
          });

        case "set_content":
          const contentModal = new ModalBuilder()
            .setCustomId("content_modal")
            .setTitle("Настройка текста сообщения");

          const contentInput = new TextInputBuilder()
            .setCustomId("message_content")
            .setLabel("Обычный текст перед embeds")
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(false)
            .setValue(session.content || "");

          const attachmentInput = new TextInputBuilder()
            .setCustomId("message_attachment")
            .setLabel("Ссылка на вложение (изображение)")
            .setStyle(TextInputStyle.Short)
            .setRequired(false)
            .setValue(session.attachment || "");

          contentModal.addComponents(
            new ActionRowBuilder().addComponents(contentInput),
            new ActionRowBuilder().addComponents(attachmentInput),
          );

          return await interaction.showModal(contentModal);

        case "preview_send":
          if (session.embeds.length === 0 && !session.content) {
            return await interaction.reply({
              content:
                "❌ Нечего отправлять. Создайте хотя бы один embed или добавьте текст.",
              ephemeral: true,
            });
          }

          const previewButtons = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId("confirm_send")
              .setLabel("✅ Отправить")
              .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
              .setCustomId("back_to_menu")
              .setLabel("🔙 Назад к меню")
              .setStyle(ButtonStyle.Secondary),
          );

          return await interaction.reply({
            content: `📦 **Предпросмотр сообщения:**\n📝 Текст: ${session.content || "_не задан_"}\n🖼 Вложение: ${session.attachment || "_не задано_"}\n📊 Embeds: ${session.embeds.length}`,
            embeds: session.embeds,
            components: [previewButtons],
            ephemeral: true,
          });

        case "confirm_send":
          const webhooks = await interaction.channel.fetchWebhooks();
          const availableWebhooks = webhooks.filter((webhook) => webhook.token);

          if (availableWebhooks.size === 0) {
            return await interaction.reply({
              content: "❌ В этом канале нет доступных вебхуков для отправки.",
              ephemeral: true,
            });
          }

          const webhookSelect = new StringSelectMenuBuilder()
            .setCustomId("select_webhook")
            .setPlaceholder("Выберите вебхук для отправки")
            .addOptions(
              Array.from(availableWebhooks.values()).map((webhook) => ({
                label: webhook.name,
                value: `${webhook.id}|${webhook.token}`,
              })),
            );

          return await interaction.update({
            content: "📩 Выберите вебхук для отправки:",
            embeds: [],
            components: [new ActionRowBuilder().addComponents(webhookSelect)],
          });

        case "back_to_menu":
          const embedCount = session.embeds.length;
          return await interaction.update({
            content: `🔧 **Управление embed-сообщением**\n📊 Создано embeds: ${embedCount}`,
            embeds: [],
            components: [createMainMenu()],
          });
      }
    }

    // Обработка модальных окон
    if (interaction.isModalSubmit()) {
      const session = userSessions.get(userId) || {
        embeds: [],
        content: "",
        attachment: "",
      };

      if (interaction.customId === "embed_modal") {
        const title = interaction.fields.getTextInputValue("embed_title");
        const description =
          interaction.fields.getTextInputValue("embed_description");
        const color = interaction.fields.getTextInputValue("embed_color");
        const image = interaction.fields.getTextInputValue("embed_image");

        const newEmbed = new EmbedBuilder();

        if (title) newEmbed.setTitle(title);
        if (description) newEmbed.setDescription(description);
        try {
          newEmbed.setColor(color);
        } catch (error) {
          console.log("Неверный формат цвета:", color);
        }
        if (image) newEmbed.setImage(image);

        session.embeds.push(newEmbed);
        userSessions.set(userId, session);
        saveSessions();

        const embedCount = session.embeds.length;
        return await interaction.reply({
          content: `✅ Embed добавлен! Всего embeds: ${embedCount}`,
          ephemeral: true,
        });
      }

      if (interaction.customId === "content_modal") {
        const content = interaction.fields.getTextInputValue("message_content");
        const attachment =
          interaction.fields.getTextInputValue("message_attachment");

        session.content = content;
        session.attachment = attachment;
        userSessions.set(userId, session);
        saveSessions();

        return await interaction.reply({
          content: "✅ Текст сообщения и вложение обновлены!",
          ephemeral: true,
        });
      }
    }

    if (interaction.isStringSelectMenu()) {
      const session = userSessions.get(userId) || {
        embeds: [],
        content: "",
        attachment: "",
      };

      if (interaction.customId === "select_delete_embed") {
        const indexToDelete = parseInt(interaction.values[0]);
        session.embeds.splice(indexToDelete, 1);
        userSessions.set(userId, session);
        saveSessions();

        return await interaction.reply({
          content: `✅ Embed удален! Осталось embeds: ${session.embeds.length}`,
          ephemeral: true,
        });
      }

      if (interaction.customId === "select_webhook") {
        const [webhookId, webhookToken] = interaction.values[0].split("|");
        const webhook = new WebhookClient({
          id: webhookId,
          token: webhookToken,
        });

        const files = [];
        if (session.attachment && session.attachment.startsWith("http")) {
          files.push(session.attachment);
        }

        try {
          await webhook.send({
            content: session.content || undefined,
            embeds: session.embeds,
            files: files.length > 0 ? files : undefined,
          });

          logAdmin(
            `Пользователь ${interaction.user.tag} отправил embed через вебхук`,
          );

          // Очистка сессии после отправки
          userSessions.delete(userId);
          saveSessions();

          return await interaction.update({
            content: "✅ Сообщение успешно отправлено!",
            embeds: [],
            components: [],
          });
        } catch (error) {
          console.error("Ошибка отправки через вебхук:", error);
          return await interaction.reply({
            content: "❌ Ошибка при отправке сообщения.",
            ephemeral: true,
          });
        }
      }
    }
  } catch (error) {
    console.error("Ошибка обработки взаимодействия:", error);

    if (!interaction.replied && !interaction.deferred) {
      try {
        await interaction.reply({
          content: "❌ Произошла ошибка при обработке команды.",
          ephemeral: true,
        });
      } catch (replyError) {
        console.error("Ошибка отправки ответа об ошибке:", replyError);
      }
    }
  }
});

// Обработка ошибок
client.on("error", (error) => {
  console.error("Ошибка Discord клиента:", error);
});

process.on("unhandledRejection", (error) => {
  console.error("Необработанное отклонение промиса:", error);
});

// Запуск бота
client.login(process.env.TOKEN);
