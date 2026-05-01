const express = require('express');
const Database = require('better-sqlite3');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// ── BANCO DE DADOS ──────────────────────────────────
const db = new Database(path.join(__dirname, 'perto.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL,
    nome TEXT NOT NULL,
    criado_em INTEGER NOT NULL,
    expira_em INTEGER NOT NULL,
    usado INTEGER DEFAULT 0,
    primeiro_acesso INTEGER DEFAULT NULL
  );
  CREATE TABLE IF NOT EXISTS respostas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL,
    perfil TEXT,
    extroversao INTEGER,
    estabilidade INTEGER,
    dados_json TEXT,
    criado_em INTEGER DEFAULT (strftime('%s','now'))
  );
`);

// ── EMAIL ────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp-relay.brevo.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  auth: {
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || ''
  }
});

async function enviarEmailAcesso(email, nome, token) {
  const link = `${process.env.BASE_URL || 'https://metodoperto.com.br'}/acesso?token=${token}`;
  const primeiroNome = nome.split(' ')[0];

  const html = `
<!DOCTYPE html>
<html lang="pt-BR">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#F8F4F0;font-family:Lato,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#F8F4F0;padding:40px 20px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.07);">
        <!-- Header -->
        <tr><td style="background:#1A1A1A;padding:32px 40px;text-align:center;">
          <div style="font-family:Georgia,serif;font-size:42px;font-weight:700;letter-spacing:10px;color:#E8856F;">PERTO</div>
          <div style="font-size:10px;letter-spacing:3px;text-transform:uppercase;color:rgba(255,255,255,0.35);margin-top:4px;">Perfil Estrutural de Temperamento</div>
        </td></tr>
        <!-- Body -->
        <tr><td style="padding:44px 40px;">
          <p style="font-family:Georgia,serif;font-size:22px;color:#1A1A1A;margin:0 0 16px;">Olá, ${primeiroNome}.</p>
          <p style="font-size:15px;line-height:1.8;color:#555;margin:0 0 16px;">Sua compra foi confirmada. Está tudo pronto para você começar o inventário.</p>
          <p style="font-size:15px;line-height:1.8;color:#555;margin:0 0 32px;">Clique no botão abaixo para acessar o PERTO. Seu link é exclusivo e ficará disponível por <strong style="color:#1A1A1A;">7 dias</strong> a partir do primeiro acesso.</p>
          <!-- CTA -->
          <table cellpadding="0" cellspacing="0" style="margin:0 auto 32px;">
            <tr><td style="background:#E8856F;border-radius:4px;">
              <a href="${link}" style="display:block;padding:18px 52px;font-size:12px;font-weight:700;letter-spacing:2.5px;text-transform:uppercase;color:#fff;text-decoration:none;">
                Acessar meu inventário
              </a>
            </td></tr>
          </table>
          <!-- Info box -->
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#F8F4F0;border-radius:8px;margin-bottom:24px;">
            <tr><td style="padding:20px 24px;">
              <p style="font-size:13px;line-height:1.75;color:#777;margin:0;">
                <strong style="color:#444;">Link exclusivo:</strong> Este link foi gerado especialmente para você e não deve ser compartilhado.<br>
                <strong style="color:#444;">Validade:</strong> 7 dias a partir do primeiro clique.<br>
                <strong style="color:#444;">Tempo estimado:</strong> ~20 minutos para completar o inventário.<br>
                <strong style="color:#444;">Relatório:</strong> Gerado automaticamente ao final, disponível em PDF.
              </p>
            </td></tr>
          </table>
          <p style="font-size:13px;color:#AAA;line-height:1.7;margin:0;">Se o botão não funcionar, copie e cole este link no navegador:<br>
          <a href="${link}" style="color:#E8856F;word-break:break-all;">${link}</a></p>
        </td></tr>
        <!-- Footer -->
        <tr><td style="background:#F5F2EE;padding:20px 40px;text-align:center;">
          <p style="font-size:11px;color:#BBB;margin:0;">PERTO — Perfil Estrutural de Temperamento<br>
          <a href="mailto:contato@metodoperto.com.br" style="color:#CCC;">contato@metodoperto.com.br</a> · metodoperto.com.br</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  await transporter.sendMail({
    from: `"Método PERTO" <contato@metodoperto.com.br>`,
    to: email,
    subject: `${primeiroNome}, seu acesso ao PERTO está pronto`,
    html
  });
}

// ── ROTAS ────────────────────────────────────────────

// Webhook da Hotmart — dispara após compra aprovada
app.post('/webhook/hotmart', async (req, res) => {
  try {
    const body = req.body;
    const event = body.event || body.hottok;

    // Hotmart envia PURCHASE_APPROVED para compra aprovada
    const isAprovado = (
      body.event === 'PURCHASE_APPROVED' ||
      body.data?.purchase?.status === 'APPROVED' ||
      body.purchase?.status === 'approved'
    );

    if (!isAprovado) {
      return res.status(200).json({ ok: true, msg: 'evento ignorado' });
    }

    // Extrair dados do comprador
    const buyer = body.data?.buyer || body.buyer || {};
    const email = buyer.email || body.email;
    const nome = buyer.name || body.name || 'Cliente';

    if (!email) {
      return res.status(400).json({ error: 'email não encontrado no webhook' });
    }

    // Gerar token com validade de 7 dias
    const token = uuidv4();
    const agora = Math.floor(Date.now() / 1000);
    const expira = agora + (7 * 24 * 60 * 60); // 7 dias em segundos

    db.prepare(`
      INSERT INTO tokens (token, email, nome, criado_em, expira_em)
      VALUES (?, ?, ?, ?, ?)
    `).run(token, email, nome, agora, expira);

    // Enviar e-mail com o link
    await enviarEmailAcesso(email, nome, token);

    res.status(200).json({ ok: true, token });
  } catch (err) {
    console.error('Erro no webhook:', err);
    res.status(500).json({ error: err.message });
  }
});

// Rota para gerar token manualmente (para testes e envios manuais)
app.post('/admin/gerar-token', (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'não autorizado' });
  }

  const { email, nome } = req.body;
  if (!email || !nome) return res.status(400).json({ error: 'email e nome são obrigatórios' });

  const token = uuidv4();
  const agora = Math.floor(Date.now() / 1000);
  const expira = agora + (7 * 24 * 60 * 60);

  db.prepare(`
    INSERT INTO tokens (token, email, nome, criado_em, expira_em)
    VALUES (?, ?, ?, ?, ?)
  `).run(token, email, nome, agora, expira);

  res.json({ ok: true, token, link: `${process.env.BASE_URL}/acesso?token=${token}` });
});

// Rota de acesso — valida token e serve o inventário
app.get('/acesso', (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.send(paginaErro('Link inválido', 'Nenhum token foi fornecido. Verifique o link enviado por e-mail.'));
  }

  const row = db.prepare('SELECT * FROM tokens WHERE token = ?').get(token);

  if (!row) {
    return res.send(paginaErro('Link não encontrado', 'Este link não existe. Verifique o e-mail que recebeu ou entre em contato com o suporte.'));
  }

  const agora = Math.floor(Date.now() / 1000);

  // Registrar primeiro acesso
  if (!row.primeiro_acesso) {
    db.prepare('UPDATE tokens SET primeiro_acesso = ? WHERE token = ?').run(agora, token);
    row.primeiro_acesso = agora;
  }

  // Verificar expiração a partir do primeiro acesso (7 dias)
  const expiracao = row.primeiro_acesso + (7 * 24 * 60 * 60);
  if (agora > expiracao) {
    return res.send(paginaErro(
      'Acesso expirado',
      `Seu acesso ao inventário expirou. O período de 7 dias é contado a partir do primeiro acesso. Para dúvidas, entre em contato: <a href="mailto:contato@metodoperto.com.br">contato@metodoperto.com.br</a>`
    ));
  }

  // Calcular tempo restante
  const diasRestantes = Math.ceil((expiracao - agora) / 86400);

  // Servir o inventário com o token embutido
  const inventario = fs.readFileSync(path.join(__dirname, 'public', 'inventario.html'), 'utf8');
  const paginaFinal = inventario
    .replace('__TOKEN__', token)
    .replace('__NOME__', row.nome)
    .replace('__DIAS_RESTANTES__', diasRestantes);

  res.send(paginaFinal);
});

// Rota para salvar resultado no banco
app.post('/salvar-resultado', (req, res) => {
  const { token, perfil, extroversao, estabilidade, dados } = req.body;

  if (!token) return res.status(400).json({ error: 'token obrigatório' });

  const row = db.prepare('SELECT * FROM tokens WHERE token = ?').get(token);
  if (!row) return res.status(404).json({ error: 'token inválido' });

  db.prepare(`
    INSERT OR REPLACE INTO respostas (token, perfil, extroversao, estabilidade, dados_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(token, perfil, extroversao, estabilidade, JSON.stringify(dados));

  res.json({ ok: true });
});

// Painel admin simples — listar respostas
app.get('/admin/respostas', (req, res) => {
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'não autorizado' });
  }

  const rows = db.prepare(`
    SELECT t.email, t.nome, t.criado_em, r.perfil, r.extroversao, r.estabilidade
    FROM tokens t
    LEFT JOIN respostas r ON t.token = r.token
    ORDER BY t.criado_em DESC
  `).all();

  res.json(rows);
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));

// ── PÁGINA DE ERRO ────────────────────────────────────
function paginaErro(titulo, mensagem) {
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PERTO — ${titulo}</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=Lato:wght@400;700&display=swap" rel="stylesheet">
<style>*{margin:0;padding:0;box-sizing:border-box;}
body{font-family:Lato,sans-serif;background:linear-gradient(145deg,#F8EDE8,#EAF0F5);min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px;}
.card{background:#fff;border-radius:14px;padding:52px;max-width:480px;text-align:center;box-shadow:0 4px 28px rgba(0,0,0,0.08);}
.logo{font-family:'Playfair Display',serif;font-size:42px;color:#E8856F;letter-spacing:8px;margin-bottom:8px;}
h2{font-family:'Playfair Display',serif;font-size:22px;color:#1A1A1A;margin:24px 0 12px;}
p{font-size:14px;line-height:1.8;color:#666;}
a{color:#E8856F;}
</style></head><body>
<div class="card">
  <div class="logo">PERTO</div>
  <h2>${titulo}</h2>
  <p>${mensagem}</p>
</div></body></html>`;
}

// ── START ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`PERTO backend rodando na porta ${PORT}`);
});
