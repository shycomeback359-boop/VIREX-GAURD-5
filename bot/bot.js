require('dotenv').config();
const { Client, GatewayIntentBits, SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField } = require('discord.js');
const crypto = require('crypto');
const db = require('../src/db');
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
const adminIds = (process.env.ADMIN_DISCORD_IDS || '').split(',').map(x => x.trim()).filter(Boolean);
const commands = [
 new SlashCommandBuilder().setName('createpanel').setDescription('Create a VIREX GUARD access panel').addStringOption(o=>o.setName('title').setDescription('Panel title').setRequired(true)).addStringOption(o=>o.setName('subtitle').setDescription('Panel subtitle').setRequired(true)).addStringOption(o=>o.setName('script').setDescription('Script ID or slug').setRequired(true)),
 new SlashCommandBuilder().setName('whitelist').setDescription('Whitelist a user for a script').addUserOption(o=>o.setName('user').setDescription('Discord user').setRequired(true)).addIntegerOption(o=>o.setName('days').setDescription('Access days').setMinValue(1).setMaxValue(3650).setRequired(true)).addStringOption(o=>o.setName('script').setDescription('Script ID or slug').setRequired(true)),
 new SlashCommandBuilder().setName('blacklist').setDescription('Revoke a user from a script').addUserOption(o=>o.setName('user').setDescription('Discord user').setRequired(true)).addStringOption(o=>o.setName('script').setDescription('Script ID or slug').setRequired(true)),
 new SlashCommandBuilder().setName('extendscript').setDescription('Extend a user entitlement').addUserOption(o=>o.setName('user').setDescription('Discord user').setRequired(true)).addIntegerOption(o=>o.setName('days').setDescription('Additional days').setMinValue(1).setMaxValue(3650).setRequired(true)).addStringOption(o=>o.setName('script').setDescription('Script ID or slug').setRequired(true)),
 new SlashCommandBuilder().setName('setbuyerrole').setDescription('Configure buyer role for this server').addRoleOption(o=>o.setName('role').setDescription('Buyer role').setRequired(true)).addStringOption(o=>o.setName('script').setDescription('Script ID or slug').setRequired(true)),
 new SlashCommandBuilder().setName('generatekey').setDescription('Generate access keys').addIntegerOption(o=>o.setName('days').setDescription('Access days').setMinValue(1).setMaxValue(3650).setRequired(true)).addIntegerOption(o=>o.setName('count').setDescription('Number of keys').setMinValue(1).setMaxValue(100).setRequired(true)).addStringOption(o=>o.setName('script').setDescription('Script ID or slug').setRequired(true)),
 new SlashCommandBuilder().setName('freemode').setDescription('Grant Discord user Premium dashboard access').addUserOption(o=>o.setName('user').setDescription('Discord user').setRequired(true)).addIntegerOption(o=>o.setName('days').setDescription('Premium days').setMinValue(1).setMaxValue(3650).setRequired(true)),
 new SlashCommandBuilder().setName('keydrop').setDescription('Generate and post a key drop').addIntegerOption(o=>o.setName('days').setDescription('Access days').setMinValue(1).setMaxValue(3650).setRequired(true)).addIntegerOption(o=>o.setName('count').setDescription('Number of keys').setMinValue(1).setMaxValue(100).setRequired(true)).addStringOption(o=>o.setName('script').setDescription('Script ID or slug').setRequired(true)),
 new SlashCommandBuilder().setName('info').setDescription('Show VIREX GUARD status')
].map(x=>x.toJSON());
const script = id => db.prepare('SELECT * FROM scripts WHERE id=? OR slug=?').get(String(id),String(id));
function createKey(s,days,issuer,redeemedBy=null){const key=crypto.randomBytes(24).toString('hex');db.prepare('INSERT INTO keys(key,script_id,days,uses_left,created_by,redeemed_by,created_at) VALUES(?,?,?,?,?,?,?)').run(key,s.id,days,redeemedBy?0:1,issuer||null,redeemedBy,Date.now());return key;}
function isAdmin(i){return adminIds.includes(i.user.id)||!!i.memberPermissions?.has(PermissionsBitField.Flags.Administrator);}
function panel(s,title,subtitle){const embed=new EmbedBuilder().setColor(0x8b5cf6).setTitle(title).setDescription(subtitle).addFields({name:'Protected script',value:s.name,inline:true},{name:'Access',value:'Key • HWID • Expiry',inline:true}).setFooter({text:'VIREX GUARD • Secure Script Access'});const row=new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`vg_redeem:${s.id}`).setLabel('REDEEM KEY').setStyle(ButtonStyle.Primary),new ButtonBuilder().setCustomId(`vg_getscript:${s.id}`).setLabel('GET SCRIPT').setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId(`vg_role:${s.id}`).setLabel('GET ROLE').setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId(`vg_hwid:${s.id}`).setLabel('RESET HWID').setStyle(ButtonStyle.Secondary),new ButtonBuilder().setCustomId(`vg_stats:${s.id}`).setLabel('GET STATS').setStyle(ButtonStyle.Secondary));return {embeds:[embed],components:[row]};}
client.once('ready',()=>{console.log(`VIREX GUARD bot online as ${client.user.tag}`);syncGuilds();setInterval(syncGuilds,5*60*1000).unref();});
async function syncGuilds(){try{for(const g of client.guilds.cache.values())db.prepare('INSERT INTO guilds(id,name,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at').run(g.id,g.name,Date.now());}catch(e){console.error('Guild sync:',e.message)}}
client.on('guildCreate',syncGuilds);client.on('guildDelete',g=>db.prepare('DELETE FROM guilds WHERE id=?').run(g.id));
client.on('interactionCreate',async i=>{
 try{
  if(i.isButton()){
   const [action,sid]=i.customId.split(':');const s=script(sid);if(!s)return i.reply({content:'This script panel is no longer available.',ephemeral:true});
   if(action==='vg_redeem')return i.reply({content:`Redeem your access key on the VIREX GUARD dashboard: ${(process.env.BASE_URL||'').replace(/\/$/,'')}/dashboard.html`,ephemeral:true});
   if(action==='vg_stats')return i.reply({content:`**${s.name}**\nExecutions: ${s.executions}\nStatus: ${s.enabled?'Enabled':'Disabled'}`,ephemeral:true});
   if(action==='vg_getscript')return i.reply({content:`**${s.name}**\n1. Redeem your key on the dashboard.\n2. Copy the generated loader from your Scripts page.\n3. Keep your script key private.`,ephemeral:true});
   if(action==='vg_hwid')return i.reply({content:`Sign in to the dashboard and choose **Reset HWID** on your access for **${s.name}**.`,ephemeral:true});
   if(action==='vg_role'){
    const mapping=db.prepare('SELECT role_id FROM buyer_roles WHERE guild_id=? AND script_id=?').get(i.guildId,s.id);if(!mapping)return i.reply({content:'A buyer role has not been configured for this script in this server.',ephemeral:true});
    const entitlement=db.prepare('SELECT expires_at FROM entitlements WHERE user_id=? AND script_id=?').get(i.user.id,s.id);if(!entitlement||entitlement.expires_at<=Date.now())return i.reply({content:'You need active access to this script before receiving the buyer role.',ephemeral:true});
    const member=await i.guild.members.fetch(i.user.id);await member.roles.add(mapping.role_id,'VIREX GUARD active script entitlement');return i.reply({content:'Your buyer role has been assigned.',ephemeral:true});
   }
  }
  if(!i.isChatInputCommand())return;const name=i.commandName;
  if(name==='info')return i.reply({content:`VIREX GUARD is online.\nServers: ${client.guilds.cache.size}\nUsers: ${db.prepare('SELECT count(*) n FROM users').get().n}\nScripts: ${db.prepare('SELECT count(*) n FROM scripts').get().n}`,ephemeral:true});
  if(!isAdmin(i))return i.reply({content:'You need administrator access to use this command.',ephemeral:true});
  if(name==='createpanel'){const s=script(i.options.getString('script'));if(!s)return i.reply({content:'Script not found. Use its script ID or slug from the dashboard.',ephemeral:true});return i.reply(panel(s,i.options.getString('title'),i.options.getString('subtitle')));}
  if(name==='freemode'){const u=i.options.getUser('user'),days=i.options.getInteger('days');db.prepare('INSERT INTO users(id,username,created_at) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING').run(u.id,u.username,Date.now());db.prepare('UPDATE users SET premium_until=max(premium_until,?) WHERE id=?').run(Date.now()+days*86400000,u.id);return i.reply({content:`Premium dashboard access enabled for <@${u.id}> for ${days} days.`,allowedMentions:{users:[u.id]}});}
  const s=script(i.options.getString('script'));if(!s)return i.reply({content:'Script not found.',ephemeral:true});
  if(name==='generatekey'||name==='keydrop'){
   const days=i.options.getInteger('days'),count=i.options.getInteger('count'),keys=[];for(let n=0;n<count;n++)keys.push(createKey(s,days,i.user.id));
   const chunks=[];for(let n=0;n<keys.length;n+=25)chunks.push(keys.slice(n,n+25));
   const first=`Generated ${keys.length} key(s) for **${s.name}** (${days} days):\n\`${chunks[0].join('\n')}\``;
   await i.reply({content:first,ephemeral:name==='generatekey'});
   for(const part of chunks.slice(1))await i.followUp({content:part.join('\n'),ephemeral:name==='generatekey'});
   return;
  }
  if(name==='setbuyerrole'){const role=i.options.getRole('role');db.prepare('INSERT INTO buyer_roles(guild_id,script_id,role_id) VALUES(?,?,?) ON CONFLICT(guild_id,script_id) DO UPDATE SET role_id=excluded.role_id').run(i.guildId,s.id,role.id);return i.reply({content:`Buyer role for **${s.name}** set to ${role}. Make sure the bot's role is above this role and has Manage Roles permission.`,ephemeral:true});}
  if(name==='whitelist'||name==='extendscript'){
   const u=i.options.getUser('user'),days=i.options.getInteger('days');db.prepare('INSERT INTO users(id,username,created_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET username=excluded.username').run(u.id,u.username,Date.now());
   const old=db.prepare('SELECT expires_at FROM entitlements WHERE user_id=? AND script_id=?').get(u.id,s.id),start=name==='extendscript'&&old&&old.expires_at>Date.now()?old.expires_at:Date.now(),expiry=start+days*86400000;
   db.prepare('INSERT INTO entitlements(user_id,script_id,expires_at) VALUES(?,?,?) ON CONFLICT(user_id,script_id) DO UPDATE SET expires_at=excluded.expires_at').run(u.id,s.id,expiry);
   const key=createKey(s,days,i.user.id,u.id);const channelName=i.channel?.name||'this channel';
   return i.reply({content:`<@${u.id}>\nYou have been whitelisted!\nYou can access the script via this message --> #${channelName}\n\nYour script key: \`${key}\`\nScript: **${s.name}**`,allowedMentions:{users:[u.id]}});
  }
  if(name==='blacklist'){const u=i.options.getUser('user');db.prepare('DELETE FROM entitlements WHERE user_id=? AND script_id=?').run(u.id,s.id);db.prepare('DELETE FROM hwids WHERE user_id=? AND script_id=?').run(u.id,s.id);db.prepare('DELETE FROM keys WHERE script_id=? AND redeemed_by=?').run(s.id,u.id);return i.reply({content:`Removed <@${u.id}> from **${s.name}**.`,allowedMentions:{users:[u.id]}});}
 }catch(e){console.error('Bot interaction:',e);const msg={content:'Command failed. Check bot logs, database access, and Discord role permissions.',ephemeral:true};if(i.replied||i.deferred)await i.followUp(msg).catch(()=>{});else await i.reply(msg).catch(()=>{});}
});
if(!process.env.DISCORD_BOT_TOKEN)console.warn('DISCORD_BOT_TOKEN missing; bot not started');else client.login(process.env.DISCORD_BOT_TOKEN);
