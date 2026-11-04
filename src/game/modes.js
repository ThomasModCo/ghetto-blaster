export const MODES = {
  tdm: { id: 'tdm', name: 'TEAM DEATHMATCH', short: 'TDM', teams: true, scoreLimit: 40, timeLimit: 300, respawn: 3.5, desc: 'Two crews. First to 40 kills runs the block.', tag: '4v4 - 6v6', bet: { label: 'WIN', odds: 1.9 } },
  ffa: { id: 'ffa', name: 'FREE FOR ALL', short: 'FFA', teams: false, scoreLimit: 20, timeLimit: 300, respawn: 3.0, desc: 'No crews, no friends. First to 20 kills.', tag: '6 - 10 PLAYERS', bet: { label: 'TOP 3', odds: 2.6 } },
  gungame: { id: 'gungame', name: 'GUN GAME', short: 'GUN GAME', teams: false, scoreLimit: 20, gunCount: 20, timeLimit: 300, respawn: 3.0, desc: 'Every kill hands you the next gun. Win with the Snubby.', tag: '6 - 10 PLAYERS', bet: { label: 'TOP 3', odds: 2.6 } },
};
