// AWS Lambda ハンドラ。Function URL(AuthType=NONE)で公開する。
// handler 入口で生の sourceIp を検査してから Express アプリ(app.mjs)に委譲する。
import serverlessExpress from "@codegenie/serverless-express";
import { app } from "./app.mjs";

// 許可する送信元IPレンジ。既定は Anthropic の outbound レンジ(160.79.104.0/21)。
// 検証時に一時的に緩める(0.0.0.0/0)場合は環境変数 ALLOWED_CIDR で上書きする。
const ALLOWED_CIDR = process.env.ALLOWED_CIDR || "160.79.104.0/21";

// IPv4 を 32bit 整数へ。不正/IPv6 は null(=不許可)。
function ipToInt(ip) {
  const parts = String(ip).split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const o = Number(p);
    if (!Number.isInteger(o) || o < 0 || o > 255) return null;
    n = (n << 8) + o;
  }
  return n >>> 0;
}

function parseCidr(cidr) {
  const [base, bitsStr] = String(cidr).split("/");
  const bits = Number(bitsStr);
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
  const net = ipToInt(base);
  return { net: net === null ? null : (net & mask) >>> 0, mask };
}

const { net, mask } = parseCidr(ALLOWED_CIDR);

function ipAllowed(ip) {
  const n = ipToInt(ip);
  if (n === null || net === null) return false;
  return ((n & mask) >>> 0) === net;
}

const expressHandler = serverlessExpress({ app });

export const handler = async (event, context) => {
  // Function URL を直叩きした場合、sourceIp は AWS が実接続元からセットする値で偽装できない
  // (X-Forwarded-For は使わない)。前段に CloudFront 等を置くと壊れる点に注意。
  const ip = event?.requestContext?.http?.sourceIp;
  if (!ip || !ipAllowed(ip)) {
    return {
      statusCode: 403,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ error: "Forbidden" }),
    };
  }
  return expressHandler(event, context);
};
