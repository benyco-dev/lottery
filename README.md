# Google Cloud Storage 정적 호스팅

서버 프로세스 없이 **Cloud Storage 버킷 하나로 웹사이트를 운영**하고,
GitHub Actions가 매주 데이터를 갱신해 자동 배포하는 구성.

배포 대상은 로또 6/45 예상번호 사이트지만, 이 저장소의 요점은 **호스팅 구성**이다.
버킷 생성부터 키 없는 CI 배포까지 실제로 돌아가는 명령어와, 그 과정에서 걸린 함정들을 적어둔다.

```
GitHub Actions ──(Workload Identity Federation, 키 파일 없음)──> GCS 버킷 ──> 공개 URL
      │
      └─ 수집 → 검증 → 데이터 갱신 커밋 → rsync 배포
```

* 서버 프로세스 0개, 컨테이너 0개, DB 0개
* 서비스 계정 **키 파일을 만들지 않는다**
* 월 비용 수백 원대 (스토리지 200KB + 트래픽)

---

## 1. 준비

아래 명령의 변수만 채우면 그대로 실행된다.

```bash
PROJECT_ID=your-project-id          # 전역 고유
BUCKET=your-bucket-name             # 전역 고유
REGION=asia-northeast3              # 서울
REPO=your-github-owner/your-repo
ORG_ID=$(gcloud organizations list --format='value(ID)' | head -1)
BILLING=$(gcloud billing accounts list --format='value(ACCOUNT_ID)' | head -1)
```

## 2. 프로젝트와 버킷

```bash
gcloud projects create "$PROJECT_ID" --organization="$ORG_ID"
gcloud billing projects link "$PROJECT_ID" --billing-account="$BILLING"
gcloud services enable storage.googleapis.com --project="$PROJECT_ID"

gcloud storage buckets create "gs://$BUCKET" \
  --project="$PROJECT_ID" --location="$REGION" --uniform-bucket-level-access
```

`--uniform-bucket-level-access` 를 켜면 객체마다 ACL을 따로 두지 않고 버킷 IAM 하나로 통제한다.
정적 사이트처럼 "전부 공개" 인 경우 이게 훨씬 단순하고, 실수로 일부 객체만 비공개가 되는 사고를 막는다.

## 3. 공개 읽기 권한

```bash
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" \
  --member=allUsers --role=roles/storage.objectViewer --project="$PROJECT_ID"
```

조직에 `constraints/storage.publicAccessPrevention` 정책이 걸려 있으면 이 명령이 거부된다.
그때는 조직 정책에서 해당 프로젝트를 예외로 두거나, 로드밸런서 뒤에 두는 구성으로 가야 한다.

## 4. 업로드

```bash
gcloud storage rsync site "gs://$BUCKET" --recursive \
  --delete-unmatched-destination-objects \
  --cache-control="public, max-age=300" \
  --project="$PROJECT_ID"
```

* `--delete-unmatched-destination-objects` — 로컬에서 지운 파일을 버킷에서도 지운다. 없으면 옛 파일이 계속 서빙된다.
* `--cache-control` — 주 1회 갱신이라 5분으로 뒀다. 이걸 안 주면 GCS 기본값 `max-age=3600` 이 붙어서 갱신이 한 시간 늦게 보인다.
* Content-Type 은 확장자로 자동 판별된다. ES 모듈(`.js`)도 `text/javascript` 로 정상 서빙된다.

## 5. 접속 URL — 여기가 함정

```bash
gcloud storage buckets update "gs://$BUCKET" \
  --web-main-page-suffix=index.html --web-error-page=index.html --project="$PROJECT_ID"
```

이 설정을 해도 **`storage.googleapis.com` 경로로는 적용되지 않는다.** 실제 응답:

| URL | 결과 |
| --- | --- |
| `storage.googleapis.com/BUCKET/index.html` | 200 `text/html` ✅ |
| `storage.googleapis.com/BUCKET/` | 200 **XML 버킷 목록** ❌ |
| `BUCKET.storage.googleapis.com/` | 200 **XML 버킷 목록** ❌ |
| `storage.googleapis.com/BUCKET/없는파일` | 404 XML (커스텀 에러 페이지 아님) ❌ |

`MainPageSuffix` / `NotFoundPage` 는 **커스텀 도메인을 CNAME 으로 붙였을 때만** 동작한다.
그래서 도메인 없이 쓰려면 공유 링크에 `/index.html` 을 붙여야 한다.

도메인을 붙이려면 Search Console 도메인 소유 확인이 필요하고,
HTTPS 까지 원하면 외부 HTTPS 로드밸런서를 얹어야 하는데 이건 트래픽과 무관하게 **월 $18 정도 고정비**가 든다.
개인 프로젝트라면 `/index.html` 을 붙이는 편이 합리적이다.

## 6. GitHub Actions에서 키 없이 배포 (WIF)

서비스 계정 JSON 키를 만들어 시크릿에 넣는 방식은 유출되면 만료도 없다.
Workload Identity Federation 은 GitHub이 발급한 OIDC 토큰을 GCP가 직접 검증하므로 **저장할 키가 없다.**

```bash
PN=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
gcloud services enable iamcredentials.googleapis.com sts.googleapis.com --project="$PROJECT_ID"

# 배포 전용 서비스 계정
gcloud iam service-accounts create gha-deploy --project="$PROJECT_ID" \
  --display-name="GitHub Actions deploy"

gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --project="$PROJECT_ID" \
  --member="serviceAccount:gha-deploy@$PROJECT_ID.iam.gserviceaccount.com" \
  --role=roles/storage.objectAdmin
gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --project="$PROJECT_ID" \
  --member="serviceAccount:gha-deploy@$PROJECT_ID.iam.gserviceaccount.com" \
  --role=roles/storage.legacyBucketReader

# 풀과 프로바이더
gcloud iam workload-identity-pools create github --location=global --project="$PROJECT_ID"
gcloud iam workload-identity-pools providers create-oidc github-actions \
  --location=global --workload-identity-pool=github --project="$PROJECT_ID" \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository=='$REPO'"

# 이 저장소에서만 서비스 계정 위임 허용
gcloud iam service-accounts add-iam-policy-binding \
  "gha-deploy@$PROJECT_ID.iam.gserviceaccount.com" --project="$PROJECT_ID" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$PN/locations/global/workloadIdentityPools/github/attribute.repository/$REPO"
```

**두 군데서 막혔던 지점**

1. **프로바이더 ID는 4~32자.** `gha` 로 만들면 `INVALID_ARGUMENT` 로 거부된다. `github-actions` 처럼 4자 이상으로.
2. **`roles/storage.objectAdmin` 만으로는 `rsync` 가 실패한다.** 객체 권한은 있지만 버킷 메타데이터 조회 권한이 없어서다.
   `roles/storage.legacyBucketReader` 를 같이 줘야 한다.
3. `--attribute-condition` 을 빼면 **GitHub의 어떤 저장소든** 이 서비스 계정을 쓸 수 있다. 반드시 넣는다.

### 저장소 시크릿

Settings → Secrets and variables → Actions 에 3개를 등록한다. 저장소에는 커밋하지 않는다.

| 시크릿 | 값 |
| --- | --- |
| `GCP_WIF_PROVIDER` | `projects/<프로젝트번호>/locations/global/workloadIdentityPools/github/providers/github-actions` |
| `GCP_SA_EMAIL` | `gha-deploy@<프로젝트ID>.iam.gserviceaccount.com` |
| `GCS_BUCKET` | 버킷 이름 |

### 워크플로

`.github/workflows/update.yml` 의 요점만:

```yaml
permissions:
  contents: write   # 갱신된 데이터를 되커밋
  id-token: write   # WIF 용 OIDC 토큰 발급. 이게 없으면 인증이 실패한다

concurrency:
  group: deploy     # 스케줄과 push 가 겹쳐 동시에 배포되는 것을 막는다

steps:
  - uses: google-github-actions/auth@v2
    with:
      workload_identity_provider: ${{ secrets.GCP_WIF_PROVIDER }}
      service_account: ${{ secrets.GCP_SA_EMAIL }}
  - uses: google-github-actions/setup-gcloud@v2
  - run: gcloud storage rsync site "gs://${{ secrets.GCS_BUCKET }}" --recursive ...
```

워크플로가 `GITHUB_TOKEN` 으로 push 해도 다른 워크플로를 다시 트리거하지 않는다(무한 루프 방지 기본 동작).
그래도 데이터에 변경이 없으면 커밋 자체를 건너뛰도록 `git diff --staged --quiet ||` 를 둔다.

## 7. 비용

| 항목 | 규모 | 월 비용 |
| --- | --- | --- |
| 스토리지 | 약 200KB | 사실상 0 |
| 클래스 A 작업 (업로드) | 주 10여 건 | 사실상 0 |
| 네트워크 이그레스 | 방문자 수에 비례 | 1GB당 약 $0.12 |
| 로드밸런서 (안 씀) | — | 썼다면 월 $18 고정 |

Cloud Run 은 요청 0이면 0으로 스케일되지만 컨테이너 빌드·레지스트리·콜드스타트가 따라온다.
정적 파일만 내보내면 되는 사이트에는 버킷이 더 단순하고 싸다.

---

## 배포되는 사이트

로또 6/45 전 회차 1등 당첨번호의 연관성을 뽑아 다음 회차 예상번호 6자리 5세트를 만든다.
예상번호는 추첨 전에 커밋되고 추첨 후 자동 채점된다.

> 로또는 매 회차 독립시행이라 어떤 조합이든 1등 확률은 8,145,060분의 1로 같습니다. 재미로만 보세요.

**모델** — 네 가지 연관성을 z점수로 합산해 가중 추출한다. 번호를 하나씩 여섯 번 뽑으며,
매번 이미 고른 번호와의 동반출현을 다시 계산해 반영한다.

| 요소 | 내용 | 가중 |
| --- | --- | ---: |
| 동반출현 | 이미 고른 번호와 같은 회차에 나온 빈도 | 1.4 |
| 최근 빈도 | 반감기 300회 가중 출현 | 1.0 |
| 직전 회차 전이 | 직전 회차 번호 다음에 나온 번호 | 0.8 |
| 미출현 기간 | 마지막 출현 이후 회차 ÷ 기대 간격 7.5 | 0.6 |

가중치는 `site/analysis.js` 의 `MODEL` 상수 하나에 모여 있다.
구조 필터(번호합 80% 구간, 홀수 2~4개, 연속쌍 1쌍 이하, 10단위 구간 3개 이상 분산)를 통과한 조합만 남긴다.

통계 탭에서는 전체 / 최근 500 / 250 / 100 / 50회 다섯 구간의 출현 분포를 따로 본다.

## 구조

```
scripts/fetch_draws.py    수집   동행복권 → site/data/draws.json
scripts/test_draws.py     검증   공식 통계 API와 번호별 출현횟수 대조
scripts/update.mjs        기록   예상번호 채점 + 다음 회차 생성 (멱등)
scripts/test_analysis.mjs 검증   통계·연관성·예상번호·채점 로직
scripts/backtest.mjs      측정   모델 성적 (배포에는 안 쓰임)

site/analysis.js          도메인 순수 함수만. DOM·fetch·전역 상태 없음
site/app.js               표현   analysis.js 결과를 그리기만 함
site/index.html, style.css
site/data/*.json          데이터 계약. 모듈 간 유일한 인터페이스
```

* **수집 ↔ 분석**: `draws.json` 이 유일한 접점. 수집기가 동행복권 응답 스키마를
  `{e, d, n[], b, w1, w2, w3, sales}` 로 좁혀 내보내고 원본 스키마가 바깥으로 새지 않는다.
  API가 또 바뀌어도 `slim()` 한 함수만 고치면 된다 (구 `common.do` API는 이미 폐지됐다).
* **도메인 ↔ 표현**: `analysis.js` 는 DOM 도 네트워크도 모른다. 그래서 브라우저와 Node
  (`update.mjs`, 테스트, 백테스트)에서 같은 코드가 그대로 돈다 — 화면의 값과 채점에 쓰인 값이 갈라질 수 없다.
* **기록 ↔ 표현**: `predictions.json` 은 추가만 하는 로그. `update.mjs` 만 쓰고 사이트는 읽기만 한다.

경계가 JSON 계약에 있어서, 나중에 API 서버가 필요해지면 `site/data/*.json` 을
같은 모양의 HTTP 엔드포인트로 바꾸는 것만으로 분리된다. 1,240행에 DB 는 필요 없다.

## 로컬 실행

```bash
python3 scripts/fetch_draws.py    # 첫 실행은 전량 수집(약 2분), 이후는 새 회차만
python3 scripts/test_draws.py     # 공식 통계와 대조
node scripts/test_analysis.mjs    # 도메인 로직 검증
node scripts/update.mjs           # 채점 + 다음 회차 예상번호
python3 -m http.server 8000 -d site
```

의존성 없음. Python 3 와 Node 18+ 표준 라이브러리만 쓴다.

## 데이터 출처

동행복권 (dhlottery.co.kr). 공개된 회차 결과 조회 엔드포인트를 요청 간 0.15초 간격으로 사용한다.
이 저장소는 동행복권과 아무 관련이 없다.
