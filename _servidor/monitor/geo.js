// Localização aproximada (cidade/estado) a partir do IP, consultada num arquivo local
// no formato MaxMind DB (.mmdb) — por padrão o "IP to City Lite" gratuito da DB-IP
// (https://db-ip.com, licença CC BY 4.0). Nada é enviado para fora e o IP não é guardado.
// Se o arquivo não existir, a localização fica vazia e o resto funciona normalmente.

const fs = require('fs');
const net = require('net');

const UF = {
  'Acre': 'AC', 'Alagoas': 'AL', 'Amapá': 'AP', 'Amazonas': 'AM', 'Bahia': 'BA', 'Ceará': 'CE',
  'Distrito Federal': 'DF', 'Federal District': 'DF', 'Espírito Santo': 'ES', 'Goiás': 'GO', 'Maranhão': 'MA',
  'Mato Grosso': 'MT', 'Mato Grosso do Sul': 'MS', 'Minas Gerais': 'MG', 'Pará': 'PA', 'Paraíba': 'PB',
  'Paraná': 'PR', 'Pernambuco': 'PE', 'Piauí': 'PI', 'Rio de Janeiro': 'RJ', 'Rio Grande do Norte': 'RN',
  'Rio Grande do Sul': 'RS', 'Rondônia': 'RO', 'Roraima': 'RR', 'Santa Catarina': 'SC', 'São Paulo': 'SP',
  'Sergipe': 'SE', 'Tocantins': 'TO'
};

function abrir(arquivo) {
  if (!arquivo || !fs.existsSync(arquivo)) return null;
  const buf = fs.readFileSync(arquivo);
  const marca = Buffer.from('\xAB\xCD\xEFMaxMind.com', 'latin1');
  const pos = buf.lastIndexOf(marca);
  if (pos < 0) throw new Error('Arquivo de localização inválido: ' + arquivo);

  // ---------- decodificador da seção de dados ----------
  function ler(base, off) {
    const ctrl = buf[off++];
    let tipo = ctrl >> 5;
    if (tipo === 1) { // ponteiro
      const s = (ctrl >> 3) & 3, v = ctrl & 7;
      let p;
      if (s === 0) { p = (v << 8) | buf[off]; off += 1; }
      else if (s === 1) { p = ((v << 16) | (buf[off] << 8) | buf[off + 1]) + 2048; off += 2; }
      else if (s === 2) { p = ((v << 24) | (buf[off] << 16) | (buf[off + 1] << 8) | buf[off + 2]) + 526336; off += 3; }
      else { p = buf.readUInt32BE(off); off += 4; }
      return [ler(base, base + p)[0], off];
    }
    if (tipo === 0) { tipo = 7 + buf[off++]; }
    let tam = ctrl & 31;
    if (tam === 29) tam = 29 + buf[off++];
    else if (tam === 30) { tam = 285 + buf.readUInt16BE(off); off += 2; }
    else if (tam === 31) { tam = 65821 + buf.readUIntBE(off, 3); off += 3; }
    const uint = () => { let n = 0; for (let i = 0; i < tam; i++) n = n * 256 + buf[off + i]; return n; };
    switch (tipo) {
      case 2: return [buf.toString('utf8', off, off + tam), off + tam];
      case 3: return [buf.readDoubleBE(off), off + 8];
      case 4: return [buf.subarray(off, off + tam), off + tam];
      case 5: case 6: case 9: case 10: return [uint(), off + tam];
      case 8: return [buf.readInt32BE(off), off + tam];
      case 14: return [tam !== 0, off];
      case 15: return [buf.readFloatBE(off), off + 4];
      case 7: { const o = {}; for (let i = 0; i < tam; i++) { let k, v; [k, off] = ler(base, off); [v, off] = ler(base, off); o[k] = v; } return [o, off]; }
      case 11: { const a = []; for (let i = 0; i < tam; i++) { let v; [v, off] = ler(base, off); a.push(v); } return [a, off]; }
      default: return [null, off + tam];
    }
  }

  const meta = ler(pos + marca.length, pos + marca.length)[0];
  const nos = meta.node_count, bits = meta.record_size, bytesNo = bits / 4;
  const inicioDados = nos * bytesNo + 16;

  function registro(no, lado) {
    const o = no * bytesNo;
    if (bits === 24) return buf.readUIntBE(o + lado * 3, 3);
    if (bits === 28) {
      const meio = buf[o + 3];
      return lado === 0 ? (((meio & 0xF0) << 20) | buf.readUIntBE(o, 3)) : (((meio & 0x0F) << 24) | buf.readUIntBE(o + 4, 3));
    }
    return buf.readUInt32BE(o + lado * 4);
  }

  // No banco IPv6, os endereços IPv4 ficam em ::/96 — acha esse nó uma vez
  let noV4 = 0;
  if (meta.ip_version === 6) for (let i = 0; i < 96 && noV4 < nos; i++) noV4 = registro(noV4, 0);

  function bytesDoIp(ip) {
    if (net.isIPv4(ip)) return ip.split('.').map(Number);
    if (!net.isIPv6(ip)) return null;
    const m = /::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
    if (m) return m[1].split('.').map(Number);
    let [a, b] = ip.split('::');
    const pa = a ? a.split(':') : [], pb = b !== undefined && b ? b.split(':') : [];
    const grupos = b === undefined ? pa : pa.concat(Array(8 - pa.length - pb.length).fill('0'), pb);
    const out = [];
    grupos.forEach((g) => { const n = parseInt(g || '0', 16); out.push(n >> 8, n & 255); });
    return out;
  }

  return function buscar(ip) {
    const b = bytesDoIp(String(ip || '').trim());
    if (!b) return null;
    let no = b.length === 4 && meta.ip_version === 6 ? noV4 : 0;
    for (let i = 0; i < b.length * 8 && no < nos; i++) no = registro(no, (b[i >> 3] >> (7 - (i & 7))) & 1);
    if (no <= nos) return null; // não encontrado
    return ler(inicioDados, inicioDados + (no - nos - 16))[0];
  };
}

// Devolve { cidade, estado } — estado é a sigla (SP, RJ…) no Brasil ou o nome do país fora dele
function criar(arquivo) {
  let buscar = null;
  try { buscar = abrir(arquivo); } catch (e) { console.error(e.message); }
  if (buscar) console.log('Localização por IP ativa: ' + arquivo);
  else console.log('Localização por IP desligada (arquivo não encontrado: ' + arquivo + ')');
  return function local(ip) {
    if (!buscar) return { cidade: '', estado: '' };
    try {
      const r = buscar(ip);
      if (!r) return { cidade: '', estado: '' };
      const nome = (x) => (x && x.names && (x.names['pt-BR'] || x.names.en)) || '';
      const pais = r.country && r.country.iso_code;
      const sub = nome((r.subdivisions || [])[0]);
      return {
        cidade: nome(r.city),
        estado: pais === 'BR' ? (UF[sub] || sub) : (nome(r.country) || pais || '')
      };
    } catch (e) {
      return { cidade: '', estado: '' };
    }
  };
}

module.exports = criar;
