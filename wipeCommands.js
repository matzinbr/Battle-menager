require('dotenv').config();
const { REST, Routes } = require('discord.js');

const TOKEN = process.env.TOKEN;
const CLIENT_ID = '1463220420818763787';
const GUILD_ID = '1461942839331127520';

const rest = new REST({ version: '10' }).setToken(TOKEN);

(async () => {
  try {
    console.log('🧹 Limpando comandos GLOBAIS...');
    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: [] }
    );

    console.log('🧹 Limpando comandos do SERVIDOR...');
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: [] }
    );

    console.log('✅ TODOS os comandos removidos');
  } catch (err) {
    console.error(err);
  }
})();
