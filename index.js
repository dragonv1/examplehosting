const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require("discord.js");

const sqlite3 = require("sqlite3").verbose();
const express = require("express");

const TOKEN = process.env.TOKEN;
const IS_RENDER = process.env.RENDER === "true";
const DB_PATH = process.env.DB_PATH || (IS_RENDER ? "/tmp/data.db" : "./data.db");
const PORT = Number(process.env.PORT) || 10000;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers
  ]
});

/* ================= DATABASE ================= */
const db = new sqlite3.Database(DB_PATH);

db.serialize(() => {

  db.run(`
  CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    userId TEXT,
    oldValue INTEGER,
    newValue INTEGER,
    amount INTEGER,
    action TEXT,
    reason TEXT,
    staffId TEXT,
    time DATETIME DEFAULT CURRENT_TIMESTAMP
  )
  `);

  db.run(`
  CREATE TABLE IF NOT EXISTS money (
    userId TEXT PRIMARY KEY,
    balance INTEGER DEFAULT 0
  )
  `);

  db.run(`
  CREATE TABLE IF NOT EXISTS career_stats (
    userId TEXT PRIMARY KEY,
    goals INTEGER DEFAULT 0,
    assists INTEGER DEFAULT 0,
    matches INTEGER DEFAULT 0
  )
  `);

});

/* ================= SYSTEM ================= */
const offers = new Map();
const pendingValueActions = new Map();

/* ================= IDS ================= */
const VIEW_OFFERS_ROLE = "1499518105481904208";
const TRANSFER_ROLE_1 = "1499518105511002161";
const TRANSFER_ROLE_2 = "1499518105511002162";
const CAREER_EDIT_ROLES = [
  "1499518105569726593",
  "1499518105569726594",
  "1499518105569726595",
  "1499518105582440518"
];

// SADECE BU KULLANICI PARA-EKLE / PARA-SIL KULLANABİLİR
const MONEY_ADMIN_USER_IDS = ["1330138758535843840"];
const MONEY_ADMIN_ROLE_IDS = ["1330138758535843840"];

const TEAM_ROLE_NAMES = [
  "Galatasaray",
  "Fenerbahçe",
  "Beşiktaş",
  "Trabzonspor",
  "Rizespor",
  "Antalyaspor",
  "Gaziantep FK",
  "Konyaspor",
  "Sivasspor",
  "Altınordu",
  "Hatayspor",
  "Adana Demirspor",
  "Samsunspor",
  "Kayserispor",
  "Eyüpspor",
  "Göztepe",
  "Başakşehir",
  "Kasımpaşa",
  "Alanyaspor"
];
const TEAM_ROLE_NAME_SET = new Set(TEAM_ROLE_NAMES.map((n) => n.toLocaleLowerCase("tr-TR")));

/* ================= ROLE CHECK ================= */
function hasRole(member, roles) {
  return member.roles.cache.some(r => roles.includes(r.id));
}

function canManageMoney(member) {
  if (!member) return false;
  return MONEY_ADMIN_USER_IDS.includes(member.id) || hasRole(member, MONEY_ADMIN_ROLE_IDS);
}


function getTeamRole(member) {
  return member.roles.cache.find((role) =>
    TEAM_ROLE_NAME_SET.has(role.name.toLocaleLowerCase("tr-TR"))
  ) || null;
}

function getAllTeamRoles(member) {
  return member.roles.cache.filter((role) =>
    TEAM_ROLE_NAME_SET.has(role.name.toLocaleLowerCase("tr-TR"))
  );
}

function setBalance(userId, balance, callback) {
  db.run(
    `INSERT INTO money (userId, balance) VALUES (?, ?)
     ON CONFLICT(userId) DO UPDATE SET balance = excluded.balance`,
    [userId, balance],
    (err) => callback(err)
  );
}

function getCareerStats(userId, callback) {
  db.get(
    `SELECT goals, assists, COALESCE(matches, 0) as matches FROM career_stats WHERE userId = ?`,
    [userId],
    (err, row) => {
      if (err) return callback({ goals: 0, assists: 0, matches: 0 });
      return callback(row || { goals: 0, assists: 0, matches: 0 });
    }
  );
}

function updateCareerStat(userId, field, amount, callback) {
  db.run(
    `INSERT INTO career_stats (userId, ${field}) VALUES (?, ?)
     ON CONFLICT(userId) DO UPDATE SET ${field} = ${field} + excluded.${field}`,
    [userId, amount],
    (err) => callback(err)
  );
}

function updateCareerMatches(userId, amount, callback) {
  db.run(
    `INSERT INTO career_stats (userId, matches) VALUES (?, ?)
     ON CONFLICT(userId) DO UPDATE SET matches = COALESCE(matches, 0) + excluded.matches`,
    [userId, amount],
    (err) => callback(err)
  );
}

function addCareerMove(userId, fromTeam, toTeam, staffId, callback) {
  db.run(
    `INSERT INTO career_moves (userId, fromTeam, toTeam, staffId) VALUES (?, ?, ?, ?)`,
    [userId, fromTeam || "Bilinmiyor", toTeam || "Bilinmiyor", staffId || "SYSTEM"],
    (err) => callback(err)
  );
}

/* ================= VALUE SYSTEM ================= */
function getValue(name) {
  const match = name.match(/(\d+)\s*M/i);
  return match ? parseInt(match[1], 10) : 0;
}

async function setValue(member, value) {
  const base = member.displayName.replace(/\|\s*\d+\s*M/i, "").trim();
  await member.setNickname(`${base} | ${value}M`).catch(() => {});
}

function createValueActionPayload(payload) {
  const actionId = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  pendingValueActions.set(actionId, payload);

  setTimeout(() => {
    pendingValueActions.delete(actionId);
  }, 1000 * 60 * 30);

  return actionId;
}

/* ================= READY ================= */
client.on("ready", () => {
  console.log(`⚽ FULL NEON SYSTEM ACTIVE: ${client.user.tag}`);
});

/* ================= RENDER HEALTH SERVER ================= */
const app = express();
app.get("/", (req, res) => {
  res.status(200).send("NEON BOT ONLINE");
});
app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true,
    botReady: client.isReady(),
    uptimeSec: Math.floor(process.uptime()),
    timestamp: new Date().toISOString()
  });
});
app.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 Health server aktif: ${PORT}`);
});

/* ================= YARDIM ================= */
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  if (message.content === "!yardım") {
    const embed = new EmbedBuilder()
      .setColor(0x00ffff)
      .setTitle("⚽ NEON RP SİSTEMİ")
      .setDescription("🚀 Tüm sistem aktif komutlar aşağıda:")
      .addFields(
        { name: "💰 !değer ver/al", value: "Oyuncu değer sistemi (onaylı)" },
        { name: "💸 !transfer gönder", value: "Oyuncuya transfer teklifi gönderir" },
        { name: "🏷️ !teklif gönder", value: "!transfer gönder komutunun aynısıdır" },
        { name: "📩 !transfer tekliflerim", value: "Gelen teklifleri gösterir" },
        { name: "💵 !para-gönder", value: "Bakiyeden kullanıcıya para yollar" },
        { name: "➕ !para-ekle", value: "Yetkili kullanıcı bakiye ekler" },
        { name: "➖ !para-sil", value: "Yetkili kullanıcı bakiye siler" },
        { name: "💳 !bal / !para", value: "Kullanıcının bakiyesini gösterir" },
        { name: "🧠 !kariyer", value: "Oyuncunun kariyer kartını gösterir (yetkili)" },
        { name: "🎮 !maç-ekle", value: "Oyuncuya oynanan maç ekler (yetkili)" },
        { name: "⚽ !gol-ekle", value: "Oyuncuya gol ekler (yetkili)" },
        { name: "🎯 !asist-ekle", value: "Oyuncuya asist ekler (yetkili)" },
        { name: "📚 !değer-geçmişi", value: "Değer değişim geçmişini gösterir" }
      )
      .setImage("https://media.tenor.com/trendyol-super-lig.gif")
      .setFooter({ text: "⚽ Rascal League | Neon Football System" });

    return message.channel.send({ embeds: [embed] });
  }
});

/* ================= DEĞER SYSTEM ================= */
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;

  const match = message.content.match(
    /^!değer\s+(ver|al)\s+<@!?(\d+)>\s+(\d+)m\s*(.*)$/i
  );

  if (!match) return;

  const action = match[1].toLowerCase();
  const userId = match[2];
  const amount = parseInt(match[3], 10);
  const reason = (match[4] || "Sebep yok").trim();

  const member = await message.guild.members.fetch(userId).catch(() => null);

  if (!member) {
    const embed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle("❌ DEĞER SİSTEMİ HATA")
      .setDescription("Kullanıcı bulunamadı!");

    return message.channel.send({ embeds: [embed] });
  }

  if (!amount || Number.isNaN(amount) || amount <= 0) {
    const embed = new EmbedBuilder()
      .setColor(0xff9900)
      .setTitle("⚠️ GEÇERSİZ MİKTAR")
      .setDescription("Lütfen geçerli bir sayı gir (örn: 5m)");

    return message.channel.send({ embeds: [embed] });
  }

  const current = getValue(member.displayName);
  let newValue = current;

  if (action === "ver") newValue += amount;
  if (action === "al") newValue -= amount;
  if (newValue < 0) newValue = 0;

  const actionId = createValueActionPayload({
    userId,
    oldValue: current,
    newValue,
    amount,
    action,
    reason
  });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`approve_${actionId}`)
      .setLabel("ONAYLA")
      .setStyle(ButtonStyle.Success),

    new ButtonBuilder()
      .setCustomId(`reject_value_${actionId}`)
      .setLabel("RED")
      .setStyle(ButtonStyle.Danger)
  );

  const embed = new EmbedBuilder()
    .setColor(0xffff00)
    .setTitle("⚠️ DEĞER GÜNCELLEME PANELİ")
    .setDescription("Bu işlem yetkili onayı gerektirir")
    .addFields(
      { name: "👤 Oyuncu", value: member.user.tag },
      { name: "📊 Eski Değer", value: `${current}M`, inline: true },
      { name: "🆕 Yeni Değer", value: `${newValue}M`, inline: true },
      { name: "⚡ İşlem Türü", value: action.toUpperCase(), inline: true },
      { name: "🧾 Sebep", value: reason }
    )
    .setThumbnail(member.user.displayAvatarURL())
    .setFooter({ text: "⚽ Rascal League Value System" });

  return message.channel.send({ embeds: [embed], components: [row] });
});

/* ================= TRANSFER GÖNDER ================= */
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;

  if (
    !message.content.startsWith("!transfer gönder") &&
    !message.content.startsWith("!teklif gönder")
  ) return;

  const member = message.member;

  if (!hasRole(member, [TRANSFER_ROLE_1, TRANSFER_ROLE_2])) {
    const embed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle("❌ YETKİ HATASI")
      .setDescription("Bu komutu kullanmak için yetkin yok.")
      .setFooter({ text: "⚽ Transfer System" });

    return message.channel.send({ embeds: [embed] });
  }

  const args = message.content.trim().split(/\s+/);
  const target = message.mentions.members.first();
  const amount = parseInt(args[3], 10);

  if (!target || args.length < 4) {
    const embed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle("⚠️ TRANSFER PANELİ")
      .setDescription("Komut eksik veya yanlış kullanıldı!")
      .addFields(
        { name: "📌 Doğru kullanım", value: "`!transfer gönder @kullanıcı miktar`" },
        { name: "📌 Örnek", value: "`!transfer gönder @Messi 5`" }
      )
      .setFooter({ text: "⚽ Rascal League Transfer System" });

    return message.channel.send({ embeds: [embed] });
  }

  if (!amount || Number.isNaN(amount) || amount <= 0) {
    const embed = new EmbedBuilder()
      .setColor(0xff9900)
      .setTitle("💰 GEÇERSİZ MİKTAR")
      .setDescription("Lütfen 0’dan büyük bir sayı gir.")
      .setFooter({ text: "⚽ Economy System" });

    return message.channel.send({ embeds: [embed] });
  }

  getBalance(member.id, (bal) => {
    if (amount > bal) {
      const embed = new EmbedBuilder()
        .setColor(0xff0000)
        .setTitle("❌ YETERSİZ BAKİYE")
        .setDescription(`💰 Bakiye: **${bal}M**\n💸 İstenen: **${amount}M**`);

      return message.channel.send({ embeds: [embed] });
    }

    if (!offers.has(target.id)) offers.set(target.id, []);

    offers.get(target.id).push({
      from: member.id,
      amount,
      status: "beklemede"
    });

    const embed = new EmbedBuilder()
      .setColor(0x00ffff)
      .setTitle("💸 TRANSFER TEKLİFİ")
      .addFields(
        { name: "👤 Gönderen", value: member.user.tag },
        { name: "🎯 Alıcı", value: target.user.tag },
        { name: "💰 Tutar", value: `${amount}M` }
      );

    return message.channel.send({ embeds: [embed] });
  });
});

/* ================= PARA GONDER ================= */
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;

  const match = message.content.match(/^!para-gönder\s+<@!?(\d+)>\s+(\d+)$/i);
  if (!match) return;

  const targetId = match[1];
  const amount = parseInt(match[2], 10);
  const sender = message.member;
  const target = await message.guild.members.fetch(targetId).catch(() => null);

  if (!target) {
    return message.channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0xff0033)
          .setTitle("❌ NEON HATA")
          .setDescription("Alıcı kullanıcı bulunamadı.")
      ]
    });
  }

  if (target.id === sender.id) {
    return message.channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0xff0033)
          .setTitle("❌ NEON HATA")
          .setDescription("Kendine para gönderemezsin.")
      ]
    });
  }

  if (!amount || Number.isNaN(amount) || amount <= 0) {
    return message.channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0xffa000)
          .setTitle("⚠️ NEON UYARI")
          .setDescription("Geçerli bir miktar gir. Örnek: `!para-gönder @kullanıcı 10`")
      ]
    });
  }

  getBalance(sender.id, (senderBalance) => {
    if (senderBalance < amount) {
      return message.channel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(0xff0033)
            .setTitle("❌ YETERSİZ BAKİYE")
            .setDescription(`Bakiyen: **${senderBalance}M**\nGöndermek istediğin: **${amount}M**`)
            .setFooter({ text: "⚡ Neon Wallet" })
        ]
      });
    }

    getBalance(target.id, (targetBalance) => {
      const newSenderBalance = senderBalance - amount;
      const newTargetBalance = targetBalance + amount;

      setBalance(sender.id, newSenderBalance, (err1) => {
        if (err1) {
          return message.channel.send("❌ Gönderen bakiyesi güncellenemedi.");
        }

        setBalance(target.id, newTargetBalance, (err2) => {
          if (err2) {
            return setBalance(sender.id, senderBalance, () => {
              message.channel.send("❌ Alıcı bakiyesi güncellenemedi, işlem geri alındı.");
            });
          }

          const embed = new EmbedBuilder()
            .setColor(0x00f5ff)
            .setTitle("💸 NEON PARA TRANSFERİ")
            .setDescription("Para transferi başarıyla tamamlandı.")
            .addFields(
              { name: "👤 Gönderen", value: sender.user.tag, inline: true },
              { name: "🎯 Alıcı", value: target.user.tag, inline: true },
              { name: "💰 Transfer", value: `${amount}M`, inline: true },
              { name: "📉 Yeni Bakiyen", value: `${newSenderBalance}M`, inline: true },
              { name: "📈 Alıcı Yeni Bakiye", value: `${newTargetBalance}M`, inline: true }
            )
            .setFooter({ text: "⚡ Neon Wallet System" });

          return message.channel.send({ embeds: [embed] });
        });
      });
    });
  });
});

/* ================= PARA EKLE / SIL ================= */
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;

  const match = message.content.match(/^!(para-ekle|para-sil)\s+<@!?(\d+)>\s+(\d+)$/i);
  if (!match) return;

  if (!canManageMoney(message.member)) {
    console.log("[PARA_YETKI_RED]", "userId:", message.author.id, "roleIds:", message.member.roles.cache.map((r) => r.id).join(","));
    return message.channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0xff0000)
          .setTitle("❌ YETKİ HATASI")
          .setDescription("Bu komut iÃ§in yetkin yok (admin rolÃ¼ veya admin user ID gerekli).")
      ]
    });
  }

  const command = match[1].toLowerCase();
  const targetId = match[2];
  const amount = parseInt(match[3], 10);

  if (!amount || Number.isNaN(amount) || amount <= 0) {
    return message.channel.send("❌ Geçerli kullanım: `!para-ekle @kullanıcı 10` / `!para-sil @kullanıcı 10`");
  }

  const target = await message.guild.members.fetch(targetId).catch(() => null);
  if (!target) {
    return message.channel.send("❌ Kullanıcı bulunamadı.");
  }

  getBalance(targetId, (currentBalance) => {
    let newBalance = currentBalance;

    if (command === "para-ekle") {
      newBalance = currentBalance + amount;
    } else {
      newBalance = Math.max(0, currentBalance - amount);
    }

    setBalance(targetId, newBalance, (err) => {
      if (err) return message.channel.send("❌ Bakiye güncellenemedi.");

      const embed = new EmbedBuilder()
        .setColor(command === "para-ekle" ? 0x00ff99 : 0xff9900)
        .setTitle(command === "para-ekle" ? "✅ PARA EKLENDİ" : "✅ PARA SİLİNDİ")
        .addFields(
          { name: "👤 Kullanıcı", value: target.user.tag, inline: true },
          { name: "💸 İşlem Miktarı", value: `${amount}M`, inline: true },
          { name: "💰 Yeni Bakiye", value: `${newBalance}M`, inline: true },
          { name: "🛠️ İşlemi Yapan", value: message.author.tag, inline: false }
        )
        .setFooter({ text: "⚡ Neon Economy Admin" });

      return message.channel.send({ embeds: [embed] });
    });
  });
});

/* ================= PARA ================= */
function getBalance(userId, callback) {
  db.get(`SELECT balance FROM money WHERE userId = ?`, [userId], (err, row) => {
    if (err) return callback(0);
    return callback(row ? row.balance : 0);
  });
}

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  if (message.content.startsWith("!para") || message.content.startsWith("!bal")) {
    if (message.content.startsWith("!para-gönder")) return;
    if (message.content.startsWith("!para-ekle")) return;
    if (message.content.startsWith("!para-sil")) return;

    const user = message.mentions.users.first() || message.author;

    db.get(`SELECT balance FROM money WHERE userId = ?`, [user.id], (err, row) => {
      const bal = row ? row.balance : 0;

      const embed = new EmbedBuilder()
        .setColor(0x00ffff)
        .setTitle("💰 NEON PARA KARTI")
        .setDescription("Kulüp ekonomisi canlı olarak güncellendi.")
        .addFields(
          { name: "👤 Kullanıcı", value: user.tag },
          { name: "💵 Para", value: `${bal}M` }
        )
        .setFooter({ text: "⚡ Neon Economy System" });

      return message.channel.send({ embeds: [embed] });
    });
  }
});

/* ================= KARIYER GOSTER ================= */
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;
  if (!message.content.startsWith("!kariyer")) return;

  if (!hasRole(message.member, CAREER_EDIT_ROLES)) {
    return message.channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0xff0000)
          .setTitle("❌ YETKİ HATASI")
          .setDescription("Bu komutu kullanmak için yetkin yok.")
          .setFooter({ text: "⚽ Career System" })
      ]
    });
  }

  const target = message.mentions.members.first() || message.member;
  const currentTeamRole = getTeamRole(target);

  getCareerStats(target.id, (stats) => {
    db.all(
      `SELECT fromTeam, toTeam, time FROM career_moves WHERE userId = ? ORDER BY id DESC LIMIT 5`,
      [target.id],
      (err, rows) => {
        const moves = rows && rows.length
          ? rows
              .map((r, i) => `${i + 1}. ${r.fromTeam} ➜ ${r.toTeam} (${new Date(r.time).toLocaleDateString("tr-TR")})`)
              .join("\n")
          : "Henüz transfer kaydı yok.";

        const embed = new EmbedBuilder()
          .setColor(0x39ffea)
          .setAuthor({
            name: "⚡ NEON KARİYER MERKEZİ",
            iconURL: target.user.displayAvatarURL()
          })
          .setTitle("🏟️ FUTBOLCU PROFİL KARTI")
          .setDescription("```ansi\n\u001b[1;36mCanlı Kariyer Verisi\u001b[0m\n```")
          .addFields(
            {
              name: "👤 Oyuncu Etiketi",
              value: `${target.user.tag}`,
              inline: false
            },
            {
              name: "📊 Performans",
              value:
                `🎮 Oynanan Maç: **${stats.matches || 0}**\n` +
                `⚽ Goller: **${stats.goals || 0}**\n` +
                `🎯 Asistler: **${stats.assists || 0}**`,
              inline: true
            },
            {
              name: "🏷️ Güncel Takım",
              value: currentTeamRole ? `**${currentTeamRole.name}**` : "Takımsız",
              inline: true
            },
            { name: "🛣️ Takım Geçmişi", value: moves }
          )
          .setThumbnail(target.user.displayAvatarURL())
          .setFooter({
            text: `${target.user.tag} • Neon Career Card`,
            iconURL: target.user.displayAvatarURL()
          })
          .setTimestamp();

        return message.channel.send({ embeds: [embed] });
      }
    );
  });
});

/* ================= MAC EKLE ================= */
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;

  const match = message.content.match(/^!maç-ekle\s+<@!?(\d+)>\s+(\d+)$/i);
  if (!match) return;

  if (!hasRole(message.member, CAREER_EDIT_ROLES)) {
    return message.channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0xff0000)
          .setTitle("❌ YETKİ HATASI")
          .setDescription("Bu komutu kullanmak için yetkin yok.")
      ]
    });
  }

  const targetId = match[1];
  const amount = parseInt(match[2], 10);
  const target = await message.guild.members.fetch(targetId).catch(() => null);

  if (!target || !amount || Number.isNaN(amount) || amount <= 0) {
    return message.channel.send("❌ Geçerli kullanım: `!maç-ekle @kullanıcı 1`");
  }

  updateCareerMatches(target.id, amount, (err) => {
    if (err) return message.channel.send("❌ Maç verisi güncellenemedi.");

    getCareerStats(target.id, (stats) => {
      const embed = new EmbedBuilder()
        .setColor(0x00ffcc)
        .setTitle("✅ MAÇ VERİSİ GÜNCELLENDİ")
        .addFields(
          { name: "👤 Oyuncu", value: target.user.tag, inline: true },
          { name: "➕ Eklenen Maç", value: `${amount}`, inline: true },
          { name: "🎮 Toplam Oynanan Maç", value: `${stats.matches || 0}`, inline: true }
        )
        .setFooter({ text: "⚡ Neon Career System" });

      return message.channel.send({ embeds: [embed] });
    });
  });
});

/* ================= GOL/ASIST EKLE ================= */
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;

  const match = message.content.match(/^!(gol-ekle|asist-ekle)\s+<@!?(\d+)>\s+(\d+)$/i);
  if (!match) return;

  if (!hasRole(message.member, CAREER_EDIT_ROLES)) {
    return message.channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0xff0000)
          .setTitle("❌ YETKİ HATASI")
          .setDescription("Bu komutu kullanmak için yetkin yok.")
      ]
    });
  }

  const type = match[1].toLowerCase();
  const targetId = match[2];
  const amount = parseInt(match[3], 10);
  const field = type === "gol-ekle" ? "goals" : "assists";
  const fieldName = type === "gol-ekle" ? "Gol" : "Asist";
  const target = await message.guild.members.fetch(targetId).catch(() => null);

  if (!target || !amount || Number.isNaN(amount) || amount <= 0) {
    return message.channel.send("❌ Geçerli kullanım: `!gol-ekle @kullanıcı 3` / `!asist-ekle @kullanıcı 2`");
  }

  updateCareerStat(target.id, field, amount, (err) => {
    if (err) return message.channel.send("❌ Kariyer verisi güncellenemedi.");

    getCareerStats(target.id, (stats) => {
      const embed = new EmbedBuilder()
        .setColor(0x00ff99)
        .setTitle("✅ KARİYER GÜNCELLENDİ")
        .addFields(
          { name: "👤 Oyuncu", value: target.user.tag, inline: true },
          { name: "➕ Eklenen", value: `${amount} ${fieldName}`, inline: true },
          { name: "⚽ Toplam Gol", value: `${stats.goals || 0}`, inline: true },
          { name: "🎯 Toplam Asist", value: `${stats.assists || 0}`, inline: true }
        )
        .setFooter({ text: "⚡ Neon Career System" });

      return message.channel.send({ embeds: [embed] });
    });
  });
});

/* ================= DEGER GECMISI ================= */
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;
  if (!message.content.startsWith("!değer-geçmişi")) return;

  const target = message.mentions.users.first() || message.author;

  db.all(
    `SELECT oldValue, newValue, amount, action, reason, time, staffId
     FROM history
     WHERE userId = ?
     ORDER BY id DESC
     LIMIT 10`,
    [target.id],
    async (err, rows) => {
      if (err) return message.channel.send("❌ Geçmiş alınırken hata oluştu.");

      const lines = rows && rows.length
        ? await Promise.all(rows.map(async (r, i) => {
            const staffTag = await client.users.fetch(r.staffId).then((u) => u.tag).catch(() => r.staffId);
            return `${i + 1}. ${r.oldValue}M ➜ ${r.newValue}M | ${r.action.toUpperCase()} ${r.amount}M | ${r.reason} | ${staffTag}`;
          }))
        : ["Kayıt bulunamadı."];

      const embed = new EmbedBuilder()
        .setColor(0x7df9ff)
        .setTitle("📚 DEĞER GEÇMİŞİ MERKEZİ")
        .setDescription(`Oyuncu: **${target.tag}**`)
        .addFields({ name: "🧾 Son 10 İşlem", value: lines.join("\n").slice(0, 1024) })
        .setFooter({ text: "⚡ Neon Value Archive" });

      return message.channel.send({ embeds: [embed] });
    }
  );
});

/* ================= TRANSFER LİST ================= */
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;

  if (message.content !== "!transfer tekliflerim") return;

  const member = message.member;

  if (!hasRole(member, [VIEW_OFFERS_ROLE])) {
    const embed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle("❌ YETKİ HATASI")
      .setDescription("Bu komutu kullanmak için yetkin yok.")
      .setFooter({ text: "⚽ Transfer System" });

    return message.channel.send({ embeds: [embed] });
  }

  const list = offers.get(member.id) || [];

  if (list.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(0xffcc00)
      .setTitle("📭 TRANSFER MERKEZİ")
      .setDescription("Şu an sana gelen hiçbir transfer teklifi yok.")
      .setFooter({ text: "⚽ Rascal League Transfer System" });

    return message.channel.send({ embeds: [embed] });
  }

  list.forEach((o, i) => {
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`accept_${member.id}_${i}`)
        .setLabel("KABUL ET")
        .setStyle(ButtonStyle.Success),

      new ButtonBuilder()
        .setCustomId(`reject_${member.id}_${i}`)
        .setLabel("REDDET")
        .setStyle(ButtonStyle.Danger),

      new ButtonBuilder()
        .setCustomId(`wait_${member.id}_${i}`)
        .setLabel("BEKLET")
        .setStyle(ButtonStyle.Secondary)
    );

    const embed = new EmbedBuilder()
      .setColor(0x00ffff)
      .setTitle("📩 TRANSFER TEKLİFİ")
      .setDescription("Sana bir transfer teklifi geldi!")
      .addFields(
        { name: "💰 Teklif Tutarı", value: `${o.amount}M`, inline: true },
        { name: "📊 Durum", value: o.status, inline: true }
      )
      .setFooter({ text: "⚽ Rascal League Transfer System" });

    message.channel.send({ embeds: [embed], components: [row] });
  });
});

/* ================= BUTTON SYSTEM ================= */
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  const data = interaction.customId.split("_");

  if (data[0] === "approve" && data.length === 2) {
    const actionId = data[1];
    const payload = pendingValueActions.get(actionId);

    if (!payload) {
      return interaction.update({
        content: "❌ Bu onay isteğinin süresi dolmuş veya geçersiz.",
        embeds: [],
        components: []
      });
    }

    const { userId, oldValue, newValue, amount, action, reason } = payload;
    const member = await interaction.guild.members.fetch(userId).catch(() => null);

    if (!member) {
      pendingValueActions.delete(actionId);
      return interaction.update({
        content: "❌ Kullanıcı bulunamadı.",
        embeds: [],
        components: []
      });
    }

    await setValue(member, newValue);

    db.run(
      `INSERT INTO history (userId, oldValue, newValue, amount, action, reason, staffId)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [userId, oldValue, newValue, amount, action, reason, interaction.user.id]
    );

    pendingValueActions.delete(actionId);

    const embed = new EmbedBuilder()
      .setColor(0x2ecc71)
      .setTitle("✅ DEĞER ONAYLANDI")
      .addFields(
        { name: "👤 Oyuncu", value: member.user.tag },
        { name: "📊 Eski Değer", value: `${oldValue}M`, inline: true },
        { name: "🆕 Yeni Değer", value: `${newValue}M`, inline: true },
        { name: "⚡ İşlem", value: action.toUpperCase(), inline: true },
        { name: "🧾 Sebep", value: reason },
        { name: "👮 Yetkili", value: interaction.user.tag }
      )
      .setThumbnail(member.user.displayAvatarURL())
      .setFooter({ text: "⚽ Value System" });

    return interaction.update({ embeds: [embed], components: [] });
  }

  if (data[0] === "reject" && data[1] === "value") {
    const actionId = data[2];
    pendingValueActions.delete(actionId);

    return interaction.update({
      content: "❌ İşlem reddedildi.",
      embeds: [],
      components: []
    });
  }

  if (
    (data[0] === "accept" || data[0] === "reject" || data[0] === "wait") &&
    data.length >= 3
  ) {
    const userId = data[1];
    const index = parseInt(data[2], 10);

    if (userId === "value" || Number.isNaN(index)) {
      return interaction.reply({
        content: "❌ Geçersiz işlem verisi.",
        ephemeral: true
      });
    }

    const list = offers.get(userId);

    if (!list || !list[index]) {
      return interaction.reply({
        content: "❌ Teklif bulunamadı veya süresi dolmuş.",
        ephemeral: true
      });
    }

    const offer = list[index];

    if (data[0] === "accept") {
      const buyerId = offer.from;
      const sellerId = userId;
      const transferAmount = offer.amount;

      const buyerMember = await interaction.guild.members.fetch(buyerId).catch(() => null);
      const sellerMember = await interaction.guild.members.fetch(sellerId).catch(() => null);

      if (!buyerMember || !sellerMember) {
        return interaction.reply({
          content: "❌ Taraflardan biri sunucuda bulunamadı.",
          ephemeral: true
        });
      }

      getBalance(buyerId, (buyerBalance) => {
        if (buyerBalance < transferAmount) {
          offer.status = "iptal edildi - bakiye yetersiz";

          return interaction.update({
            content: `❌ Teklif iptal edildi. Gönderenin bakiyesi yetersiz (${buyerBalance}M).`,
            embeds: [],
            components: []
          });
        }

        getBalance(sellerId, (sellerBalance) => {
          const newBuyerBalance = buyerBalance - transferAmount;
          const newSellerBalance = sellerBalance + transferAmount;

          setBalance(buyerId, newBuyerBalance, (err1) => {
            if (err1) {
              return interaction.update({
                content: "❌ Transfer sırasında gönderen bakiyesi güncellenemedi.",
                embeds: [],
                components: []
              });
            }

            setBalance(sellerId, newSellerBalance, async (err2) => {
              if (err2) {
                return setBalance(buyerId, buyerBalance, () => {
                  interaction.update({
                    content: "❌ Transfer sırasında alıcı bakiyesi güncellenemedi, işlem geri alındı.",
                    embeds: [],
                    components: []
                  });
                });
              }

              offer.status = "kabul edildi";
              const buyerTeamRole = getTeamRole(buyerMember);
              const sellerOldTeamRole = getTeamRole(sellerMember);

              let roleText = "Gönderen kullanıcıda tanımlı takım rolü bulunamadı.";
              if (buyerTeamRole) {
                const sellerTeamRoles = getAllTeamRoles(sellerMember);
                const hadBuyerRole = sellerMember.roles.cache.has(buyerTeamRole.id);

                if (!hadBuyerRole) {
                  const roleResult = await sellerMember.roles.add(buyerTeamRole.id).catch(() => null);
                  if (roleResult) {
                    roleText = `Takım rolü verildi: ${buyerTeamRole.name}`;
                  } else {
                    roleText = "Takım rolü verilemedi (yetki/pozisyon kontrol et).";
                  }
                } else {
                  roleText = `Kabul eden kişide zaten ${buyerTeamRole.name} rolü vardı.`;
                }

                if (roleText.startsWith("Takım rolü verildi") || roleText.includes("zaten")) {
                  const rolesToRemove = sellerTeamRoles.filter((r) => r.id !== buyerTeamRole.id);
                  if (rolesToRemove.size > 0) {
                    await sellerMember.roles.remove(rolesToRemove.map((r) => r.id)).catch(() => null);
                  }
                }

                if (roleText.startsWith("Takım rolü verildi") || roleText.includes("zaten")) {
                  addCareerMove(
                    sellerId,
                    sellerOldTeamRole ? sellerOldTeamRole.name : "Takımsız",
                    buyerTeamRole.name,
                    interaction.user.id,
                    () => {}
                  );
                }
              }

              const doneEmbed = new EmbedBuilder()
                .setColor(0x00f5ff)
                .setTitle("✅ TRANSFER TAMAMLANDI")
                .addFields(
                  { name: "💸 Transfer Tutarı", value: `${transferAmount}M`, inline: true },
                  { name: "🧾 Gönderen Yeni Para", value: `${newBuyerBalance}M`, inline: true },
                  { name: "🧾 Kabul Eden Yeni Para", value: `${newSellerBalance}M`, inline: true },
                  { name: "🏟️ Takım Rolü Durumu", value: roleText }
                )
                .setFooter({ text: "⚽ Rascal League Transfer System" });

              return interaction.update({
                embeds: [doneEmbed],
                components: []
              });
            });
          });
        });
      });

      return;
    }

    if (data[0] === "reject") {
      offer.status = "reddedildi";

      return interaction.update({
        content: "❌ Transfer reddedildi!",
        embeds: [],
        components: []
      });
    }

    if (data[0] === "wait") {
      offer.status = "beklemede";

      return interaction.reply({
        content: "⏳ Teklif beklemeye alındı.",
        ephemeral: true
      });
    }
  }
});

client.login(TOKEN);
