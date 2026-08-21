#!/usr/bin/env python3
"""
mbFAST / mbPIT インデックス漏れ検知

WordPress REST API から直近の公開記事を取得し、Google Search Console の
URL Inspection API で 1 件ずつインデックス状況を照会する。
未インデックスの URL だけを標準出力・GitHub Actions Job Summary に出す。

必要な環境変数:
  GSC_SA_JSON   サービスアカウントの JSON キー（中身をそのまま）
  GSC_SITE_URL  Search Console のプロパティ。ドメインプロパティなら
                "sc-domain:mbfasttuning.com"、URL プレフィックスなら
                "https://mbfasttuning.com/"
任意:
  WP_BASE       既定 https://mbfasttuning.com
  LOOKBACK_DAYS 何日前までの記事を見るか（既定 60）
  SKIP_DAYS     直近何日を除外するか（既定 3。GSC の反映待ちのため）
  MAX_URLS      1 回で照会する上限（既定 120。API は 2000/日）
"""

from __future__ import annotations

import json
import os
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

import google.auth.transport.requests
from google.oauth2 import service_account

SCOPES = ["https://www.googleapis.com/auth/webmasters.readonly"]
INSPECT_ENDPOINT = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect"
UA = "curl/8.4.0"  # mbfasttuning.com の WAF はブラウザ UA を弾く

WP_BASE = os.environ.get("WP_BASE", "https://mbfasttuning.com").rstrip("/")
SITE_URL = os.environ["GSC_SITE_URL"]
LOOKBACK_DAYS = int(os.environ.get("LOOKBACK_DAYS", "60"))
SKIP_DAYS = int(os.environ.get("SKIP_DAYS", "3"))
MAX_URLS = int(os.environ.get("MAX_URLS", "120"))

# インデックス済みとみなす verdict
OK_VERDICTS = {"PASS"}


def wp_get(path: str, params: dict) -> list:
    """WordPress REST API から JSON を取得する。"""
    url = f"{WP_BASE}{path}?{urllib.parse.urlencode(params)}"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as res:
        return json.loads(res.read().decode("utf-8"))


def collect_urls() -> list[dict]:
    """直近の公開記事 URL を集める（新しすぎるものは除外）。"""
    now = datetime.now(timezone.utc)
    after = (now - timedelta(days=LOOKBACK_DAYS)).strftime("%Y-%m-%dT%H:%M:%S")
    before = (now - timedelta(days=SKIP_DAYS)).strftime("%Y-%m-%dT%H:%M:%S")

    items: list[dict] = []
    for page in range(1, 6):
        try:
            batch = wp_get(
                "/wp-json/wp/v2/posts",
                {
                    "per_page": 100,
                    "page": page,
                    "after": after,
                    "before": before,
                    "status": "publish",
                    "orderby": "date",
                    "order": "desc",
                    "_fields": "id,link,title,date",
                },
            )
        except Exception as exc:  # noqa: BLE001
            print(f"WP fetch stopped at page {page}: {exc}", file=sys.stderr)
            break
        if not batch:
            break
        items.extend(batch)
        if len(batch) < 100:
            break

    seen, out = set(), []
    for it in items:
        link = it.get("link")
        if link and link not in seen:
            seen.add(link)
            out.append(it)
    return out[:MAX_URLS]


def inspect(session, url: str) -> dict:
    """URL Inspection API を 1 件叩く。"""
    payload = json.dumps(
        {"inspectionUrl": url, "siteUrl": SITE_URL, "languageCode": "ja"}
    ).encode("utf-8")
    res = session.post(
        INSPECT_ENDPOINT,
        data=payload,
        headers={"Content-Type": "application/json"},
        timeout=45,
    )
    if res.status_code != 200:
        return {"_error": f"HTTP {res.status_code}: {res.text[:200]}"}
    return res.json().get("inspectionResult", {})


def main() -> int:
    creds = service_account.Credentials.from_service_account_info(
        json.loads(os.environ["GSC_SA_JSON"]), scopes=SCOPES
    )
    session = google.auth.transport.requests.AuthorizedSession(creds)

    targets = collect_urls()
    print(f"checking {len(targets)} URLs (property: {SITE_URL})")

    problems, errors, ok = [], [], 0

    for i, item in enumerate(targets, 1):
        result = inspect(session, item["link"])

        if "_error" in result:
            errors.append({**item, "detail": result["_error"]})
        else:
            status = result.get("indexStatusResult", {})
            verdict = status.get("verdict", "UNKNOWN")
            if verdict in OK_VERDICTS:
                ok += 1
            else:
                problems.append(
                    {
                        **item,
                        "verdict": verdict,
                        "coverage": status.get("coverageState", ""),
                        "robots": status.get("robotsTxtState", ""),
                        "fetch": status.get("pageFetchState", ""),
                        "last_crawl": status.get("lastCrawlTime", "未クロール"),
                    }
                )

        # 600 req/min の上限に対する安全マージン
        if i % 20 == 0:
            time.sleep(2)

    # ---- 出力 ----
    lines = [
        "# インデックス状況チェック",
        "",
        f"- 対象: 直近 {LOOKBACK_DAYS} 日の公開記事（直近 {SKIP_DAYS} 日は除外）",
        f"- 照会: {len(targets)} 件 / インデックス済み: {ok} 件 / 要確認: {len(problems)} 件",
        "",
    ]

    if problems:
        lines += [
            "## 要確認",
            "",
            "| 記事 | verdict | カバレッジ | 最終クロール |",
            "| --- | --- | --- | --- |",
        ]
        for p in problems:
            title = (p.get("title") or {}).get("rendered", "")[:48]
            lines.append(
                f"| [{title}]({p['link']}) | {p['verdict']} | {p['coverage']} | {p['last_crawl']} |"
            )
        lines.append("")
    else:
        lines += ["対象記事はすべてインデックス済みです。", ""]

    if errors:
        lines += ["## API エラー", ""]
        lines += [f"- {e['link']} — {e['detail']}" for e in errors]
        lines.append("")

    report = "\n".join(lines)
    print(report)

    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write(report + "\n")

    out = os.environ.get("GITHUB_OUTPUT")
    if out:
        with open(out, "a", encoding="utf-8") as fh:
            fh.write(f"problem_count={len(problems)}\n")
            fh.write(f"checked_count={len(targets)}\n")

    with open("index-check-result.json", "w", encoding="utf-8") as fh:
        json.dump(
            {"checked": len(targets), "ok": ok, "problems": problems, "errors": errors},
            fh,
            ensure_ascii=False,
            indent=2,
        )

    return 0


if __name__ == "__main__":
    sys.exit(main())
