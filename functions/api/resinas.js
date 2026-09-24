/* Painel de resinas PP e PE, lógica LME:
   preço USD/t (âncora Baird + trajetória ABIPLAST) x câmbio do dia = R$/t.
   Brent e dólar vêm DIÁRIOS e reais da FRED (gatilho antecipado).
   Chave em env FRED_API_KEY (Cloudflare). */

const FRED = "https://api.stlouisfed.org/fred/series/observations";
const LB_POR_T = 2204.62;

// âncora real março/2026 (relatório Baird, US$/libra -> US$/t)
const ANCORA_MAR = { pp: 0.62 * LB_POR_T, pe: 0.67 * LB_POR_T, pvc: 0.58 * LB_POR_T };
// trajetória relativa (mar=1.00), dos percentuais oficiais ABIPLAST/EconoPlast
const TRAJ = {
  pp: {"2026-01":0.82,"2026-02":0.86,"2026-03":1.00,"2026-04":1.28,"2026-05":1.42,"2026-06":1.40,"2026-07":1.38,"2026-08":1.39},
  pe: {"2026-01":0.80,"2026-02":0.84,"2026-03":1.00,"2026-04":1.33,"2026-05":1.53,"2026-06":1.52,"2026-07":1.49,"2026-08":1.50},
  pvc:{"2026-01":0.84,"2026-02":0.88,"2026-03":1.00,"2026-04":1.45,"2026-05":1.62,"2026-06":1.58,"2026-07":1.55,"2026-08":1.56}
};
const NOME_RES = { pp:"Polipropileno", pe:"Polietileno", pvc:"PVC" };

async function serie(id, chave, desde){
  const u = FRED+"?series_id="+id+"&api_key="+chave+"&file_type=json&observation_start="+desde+"&sort_order=asc";
  const r = await fetch(u);
  if(!r.ok) throw new Error("FRED "+id+" HTTP "+r.status);
  const j = await r.json();
  const out = [];
  for(const o of (j.observations||[])){
    const v = parseFloat(o.value);
    if(o.value!=="." && !isNaN(v)) out.push([o.date, v]);
  }
  return out;
}

// câmbio médio por mês a partir da série diária
function cambioMensal(diario){
  const acc = {};
  for(const [d,v] of diario){ const m=d.slice(0,7); (acc[m]=acc[m]||[]).push(v); }
  const med = {};
  for(const m in acc) med[m] = acc[m].reduce((a,b)=>a+b,0)/acc[m].length;
  return med;
}

export async function onRequest(context){
  const chave = context.env && context.env.FRED_API_KEY;
  if(!chave) return new Response(JSON.stringify({erro:"FRED_API_KEY não configurada"}),
    {status:500, headers:{"content-type":"application/json; charset=utf-8"}});

  try{
    // diários reais: Brent (US$/barril) e dólar (R$/US$)
    const brent = await serie("DCOILBRENTEU", chave, "2026-01-01");
    const usd   = await serie("DEXBZUS",      chave, "2026-01-01");  // R$/US$ diário (Fed)
    const cam   = cambioMensal(usd);
    const usdHoje = usd.length ? usd[usd.length-1][1] : null;
    // agregado do setor de plásticos (índice FRED, mensal)
    let agregado = [];
    try{
      const ag = await serie("WPU0662", chave, "2024-01-01");
      agregado = ag.map(([d,v])=>({mes:d.slice(0,7), indice:v}));
    }catch(e){ agregado = []; }

    // resinas mensais em USD/t e BRL/t (lógica LME)
    const resinas = {};
    for(const r of ["pp","pe","pvc"]){
      const meses = Object.keys(TRAJ[r]).sort();
      resinas[r] = {
        nome: NOME_RES[r],
        dados: meses.map(m=>{
          const usdT = ANCORA_MAR[r]*TRAJ[r][m];
          const cambio = cam[m] || usdHoje;
          return { mes:m, usdT:+usdT.toFixed(2), cambio:+(cambio||0).toFixed(4), brlT:+(usdT*(cambio||0)).toFixed(2) };
        })
      };
    }

    return new Response(JSON.stringify({
      fonte: "Brent+câmbio: FRED (diário). PP/PE: âncora Baird mar/26 + trajetória ABIPLAST (mensal).",
      nota: "R$/t = US$/t × câmbio, mesma lógica do painel LME. Preço de resina é estimativa reconstruída; Brent e dólar são diários e oficiais.",
      atualizado: new Date().toISOString(),
      brent: brent.slice(-260),
      dolar: usd.slice(-260),
      agregado,
      usdHoje,
      resinas
    }), { headers:{
      "content-type":"application/json; charset=utf-8",
      "access-control-allow-origin":"*",
      "cache-control":"public, max-age=10800, s-maxage=10800"
    }});
  }catch(e){
    return new Response(JSON.stringify({erro:String(e.message||e)}),
      {status:502, headers:{"content-type":"application/json; charset=utf-8"}});
  }
}
