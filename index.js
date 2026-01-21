// ---------- WORK COM YENS, JACKPOT E SURPRESA ----------
if (interaction.commandName === 'work') {
  const now = DateTime.now().setZone(TZ);
  if ((now.weekday !== 7 || now.hour < 9 || now.hour >= 24) && !isAdmin) {
    return interaction.reply({ content: '⛔ O WORK só funciona aos domingos, das 9:00 às 23:59!', ephemeral: true });
  }

  const ranking = await loadRanking();
  if (!ranking.players[interaction.user.id]) 
      ranking.players[interaction.user.id] = { name: interaction.user.username, wins:0, losses:0, streak:0, yens:0, lastWork: null };

  // Verifica se já usou /work hoje
  const lastWork = ranking.players[interaction.user.id].lastWork;
  if (lastWork) {
    const lastDate = DateTime.fromISO(lastWork).setZone(TZ);
    if (lastDate.hasSame(now, 'week')) {
      return interaction.reply({ content: '⏱ Você já usou /work este domingo! Tente novamente no próximo domingo.', ephemeral: true });
    }
  }

  let reward = WORK_REWARD;
  let jackpot = '';
  if (Math.random() < 0.12) { 
    const multiplier = Math.floor(Math.random()*3)+2;
    reward *= multiplier;
    jackpot = ` 🎉 JACKPOT ${multiplier}x!`;
  }

  // Surpresa secreta
  if (Math.random() < 0.05) reward += 50;

  ranking.players[interaction.user.id].yens += reward;
  ranking.players[interaction.user.id].lastWork = now.toISO();

  await saveRanking(ranking);

  const embed = new EmbedBuilder()
    .setTitle('💼 WORK realizado!')
    .setDescription(`${interaction.user.username} recebeu ${reward} ${CURRENCY_EMOJI}${jackpot}`)
    .setColor(0x00ff99)
    .setTimestamp();
  return interaction.reply({ embeds: [embed] });
}
