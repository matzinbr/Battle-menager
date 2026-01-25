import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import fs from 'fs/promises';
import path from 'path';
import { DateTime } from 'luxon';

const CONFIG_PATH = path.join(process.cwd(), 'apostasConfig.json');

// ===== Funções utilitárias =====
async function loadConfig() {
  try {
    const data = await fs.readFile(CONFIG_PATH, 'utf8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function saveConfig(config) {
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// ===== Comando =====
export const data = new SlashCommandBuilder()
  .setName('apostas')
  .setDescription('Gerenciar apostas do servidor')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand(sub =>
    sub
      .setName('criar')
      .setDescription('Define data e hora para habilitar a aposta')
      .addStringOption(o =>
        o.setName('data')
          .setDescription('Data da aposta (AAAA-MM-DD)')
          .setRequired(true)
      )
      .addStringOption(o =>
        o.setName('hora')
          .setDescription('Hora da aposta (HH:mm, 24h)')
          .setRequired(true)
      )
  )
  .addSubcommand(sub =>
    sub
      .setName('editar_nome')
      .setDescription('Alterar o nome do comando da aposta')
      .addStringOption(o =>
        o.setName('novo_nome')
          .setDescription('Novo nome para o comando')
          .setRequired(true)
      )
  )
  .addSubcommand(sub =>
    sub.setName('status').setDescription('Mostra a configuração atual da aposta'));

// ===== Execução =====
export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;

  const config = await loadConfig();
  if (!config[guildId]) config[guildId] = { enabled: false, date: null, time: null, commandName: 'shenanigans_bet' };

  if (sub === 'criar') {
    const dateStr = interaction.options.getString('data');
    const timeStr = interaction.options.getString('hora');

    const dt = DateTime.fromISO(`${dateStr}T${timeStr}`, { zone: 'America/Sao_Paulo' });
    if (!dt.isValid || dt < DateTime.now().setZone('America/Sao_Paulo')) {
      return interaction.reply({ content: '❌ Data ou hora inválida!', ephemeral: true });
    }

    config[guildId].enabled = true;
    config[guildId].date = dt.toISODate();
    config[guildId].time = dt.toFormat('HH:mm');

    await saveConfig(config);

    const embed = new EmbedBuilder()
      .setTitle('🎲 Aposta Agendada!')
      .setDescription(`Aposta ativa a partir de:`)
      .addFields(
        { name: 'Data', value: dt.toFormat('dd/LL/yyyy'), inline: true },
        { name: 'Hora', value: dt.toFormat('HH:mm'), inline: true }
      )
      .setColor('Green')
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  if (sub === 'editar_nome') {
    const novoNome = interaction.options.getString('novo_nome');

    // Verifica permissão: admin ou dono
    const member = interaction.member;
    if (!member.permissions.has(PermissionFlagsBits.Administrator) && interaction.guild.ownerId !== interaction.user.id) {
      return interaction.reply({ content: '❌ Apenas admins ou dono podem alterar o nome!', ephemeral: true });
    }

    const antigo = config[guildId].commandName;
    config[guildId].commandName = novoNome;
    await saveConfig(config);

    const embed = new EmbedBuilder()
      .setTitle('✏️ Nome da Aposta Alterado')
      .setDescription(`**Nome antigo:** ${antigo}\n**Novo nome:** ${novoNome}`)
      .setColor('Yellow')
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  if (sub === 'status') {
    const cfg = config[guildId];
    const embed = new EmbedBuilder()
      .setTitle('📊 Status da Aposta')
      .addFields(
        { name: 'Ativa?', value: cfg.enabled ? '✅ Sim' : '❌ Não', inline: true },
        { name: 'Data', value: cfg.date || 'Não definida', inline: true },
        { name: 'Hora', value: cfg.time || 'Não definida', inline: true },
        { name: 'Comando', value: cfg.commandName || 'shenanigans_bet', inline: true }
      )
      .setColor(cfg.enabled ? 'Green' : 'Red')
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }
}
import { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } from 'discord.js';
import fs from 'fs/promises';
import path from 'path';
import { DateTime } from 'luxon';

const CONFIG_PATH = path.join(process.cwd(), 'apostasConfig.json');

// ===== Funções utilitárias =====
async function loadConfig() {
  try {
    const data = await fs.readFile(CONFIG_PATH, 'utf8');
    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function saveConfig(config) {
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
}

// ===== Comando =====
export const data = new SlashCommandBuilder()
  .setName('apostas')
  .setDescription('Gerenciar apostas do servidor')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand(sub =>
    sub
      .setName('criar')
      .setDescription('Define data e hora para habilitar a aposta')
      .addStringOption(o =>
        o.setName('data')
          .setDescription('Data da aposta (AAAA-MM-DD)')
          .setRequired(true)
      )
      .addStringOption(o =>
        o.setName('hora')
          .setDescription('Hora da aposta (HH:mm, 24h)')
          .setRequired(true)
      )
  )
  .addSubcommand(sub =>
    sub
      .setName('editar_nome')
      .setDescription('Alterar o nome do comando da aposta')
      .addStringOption(o =>
        o.setName('novo_nome')
          .setDescription('Novo nome para o comando')
          .setRequired(true)
      )
  )
  .addSubcommand(sub =>
    sub.setName('status').setDescription('Mostra a configuração atual da aposta'));

// ===== Execução =====
export async function execute(interaction) {
  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;

  const config = await loadConfig();
  if (!config[guildId]) config[guildId] = { enabled: false, date: null, time: null, commandName: 'shenanigans_bet' };

  if (sub === 'criar') {
    const dateStr = interaction.options.getString('data');
    const timeStr = interaction.options.getString('hora');

    const dt = DateTime.fromISO(`${dateStr}T${timeStr}`, { zone: 'America/Sao_Paulo' });
    if (!dt.isValid || dt < DateTime.now().setZone('America/Sao_Paulo')) {
      return interaction.reply({ content: '❌ Data ou hora inválida!', ephemeral: true });
    }

    config[guildId].enabled = true;
    config[guildId].date = dt.toISODate();
    config[guildId].time = dt.toFormat('HH:mm');

    await saveConfig(config);

    const embed = new EmbedBuilder()
      .setTitle('🎲 Aposta Agendada!')
      .setDescription(`Aposta ativa a partir de:`)
      .addFields(
        { name: 'Data', value: dt.toFormat('dd/LL/yyyy'), inline: true },
        { name: 'Hora', value: dt.toFormat('HH:mm'), inline: true }
      )
      .setColor('Green')
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  if (sub === 'editar_nome') {
    const novoNome = interaction.options.getString('novo_nome');

    // Verifica permissão: admin ou dono
    const member = interaction.member;
    if (!member.permissions.has(PermissionFlagsBits.Administrator) && interaction.guild.ownerId !== interaction.user.id) {
      return interaction.reply({ content: '❌ Apenas admins ou dono podem alterar o nome!', ephemeral: true });
    }

    const antigo = config[guildId].commandName;
    config[guildId].commandName = novoNome;
    await saveConfig(config);

    const embed = new EmbedBuilder()
      .setTitle('✏️ Nome da Aposta Alterado')
      .setDescription(`**Nome antigo:** ${antigo}\n**Novo nome:** ${novoNome}`)
      .setColor('Yellow')
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }

  if (sub === 'status') {
    const cfg = config[guildId];
    const embed = new EmbedBuilder()
      .setTitle('📊 Status da Aposta')
      .addFields(
        { name: 'Ativa?', value: cfg.enabled ? '✅ Sim' : '❌ Não', inline: true },
        { name: 'Data', value: cfg.date || 'Não definida', inline: true },
        { name: 'Hora', value: cfg.time || 'Não definida', inline: true },
        { name: 'Comando', value: cfg.commandName || 'shenanigans_bet', inline: true }
      )
      .setColor(cfg.enabled ? 'Green' : 'Red')
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }
}
