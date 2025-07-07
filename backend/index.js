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

    // Если пользователь не имеет сессии, создаем новую
    if (!userSessions.has(userId)) {
      userSessions.set(userId, { embeds: [], content: "", attachment: "" });
    }

    const session = userSessions.get(userId);

    if (interaction.isChatInputCommand() && interaction.commandName === "embed") {
      // Проверка прав администратора
      if (!interaction.member.permissions.has("Administrator")) {
        return await interaction.reply({
          content: "❌ Только администратор может использовать эту команду.",
          ephemeral: true,
        });
      }

      const embedCount = session.embeds.length;

      // Поняли ли мы, был ли уже ответ на это взаимодействие?
      if (!interaction.replied) {
        return await interaction.reply({
          content: `🔧 **Управление embed-сообщением**\n📊 Создано embeds: ${embedCount}`,
          components: [createMainMenu()],
          ephemeral: true,
        });
      }
    }

    // Обработка кнопок
    if (interaction.isButton()) {
      switch (interaction.customId) {
        case "add_embed":
          // Логика добавления нового embed
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

          // Проверка, был ли уже ответ на это взаимодействие
          if (!interaction.replied) {
            return await interaction.reply({
              content: `📦 **Предпросмотр сообщения:**\n📝 Текст: ${session.content || "_не задан_"}\n🖼 Вложение: ${session.attachment || "_не задано_"}\n📊 Embeds: ${session.embeds.length}`,
              embeds: session.embeds,
              components: [previewButtons],
              ephemeral: true,
            });
          }
          break;

        case "confirm_send":
          const webhooks = await interaction.channel.fetchWebhooks();
          const availableWebhooks = webhooks.filter(webhook => webhook.token);

          if (availableWebhooks.size === 0) {
            // Создание вебхука, если его нет
            const channel = interaction.channel;
            const newWebhook = await channel.createWebhook({
              name: "Embed Bot Webhook",
              avatar: client.user.avatarURL(),
            });

            logAdmin(`Создан новый вебхук для канала ${channel.name}`);

            const webhook = new WebhookClient({
              id: newWebhook.id,
              token: newWebhook.token,
            });

            await sendEmbedMessage(webhook, session);
          } else {
            const webhook = availableWebhooks.first();
            await sendEmbedMessage(webhook, session);
          }

          // Очистка сессии после отправки
          userSessions.delete(userId);
          saveSessions();

          // Проверка, был ли уже ответ на это взаимодействие
          if (!interaction.replied) {
            return await interaction.update({
              content: "✅ Сообщение успешно отправлено!",
              embeds: [],
              components: [],
            });
          }
          break;
      }
    }
  } catch (error) {
    console.error("Ошибка обработки взаимодействия:", error);
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
