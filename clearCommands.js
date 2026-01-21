require('dotenv').config();
const { REST, Routes } = require('discord.js');

const rest = new REST({ version: '10' }).setToken(process.env.TOKEN);

(async () => {
  try {
    console.log('🧹 Limpando comandos globais...');
    await rest.put(
      Routes.applicationCommands('1463220420818763787'),
      { body: [] }
    );
    console.log('✅ Comandos globais removidos');
  } catch (err) {
    console.error(err);
  }
})();
