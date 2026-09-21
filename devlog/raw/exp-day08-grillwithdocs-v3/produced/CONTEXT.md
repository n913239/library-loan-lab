# 圖書館借閱

單一館、一書一冊的借閱規則:書借走了別人就不能借,還了才能借。對內是「有限資源的分配規則」壓到最簡。

## Language

### 書與讀者

**書(Book)**:
一本實體書,一列就是一冊,沒有副本的概念。
_Avoid_: 副本、館藏、copy、item

**書的狀態(Book status)**:
書當下能不能借,只有 `available`(可借)與 `on_loan`(借出中)兩種,轉移只有 `available → on_loan → available`。
_Avoid_: 已借、borrowed、checked out、reserved

**讀者(User)**:
借書的人;系統只認 id 與 name,不驗身分、不分角色。
_Avoid_: 會員、館員、patron、reader、account

### 借閱

**借閱(Borrow)**:
讀者把一本書借走並在到期時刻前歸還的整件事;本專案的核心領域。英文以 `borrow` 為主。
_Avoid_: loan(見「契約遺留」)、lending、checkout、出借

**借書 / 還書(Borrow / Return)**:
讀者對一本書做的兩個動作,分別把書從 `available` 帶到 `on_loan`、再帶回 `available`。
_Avoid_: 借出、歸還登記、check in / check out

**借閱紀錄(Borrow record)**:
一次借閱的事實紀錄,狀態 `active → returned`,`returned` 是終態。未歸還 ⇔ `active`;「逾期」不是狀態,只是逾期天數大於零。
_Avoid_: loan record、交易、transaction、訂單

**未歸還 / 已歸還(Active / Returned)**:
借閱紀錄的兩個狀態。同一本書同一時刻至多一筆未歸還紀錄。
_Avoid_: 進行中、open / closed、pending

### 時間

**現在(Now)**:
每個請求取一次、從外面傳進領域邏輯的時刻,領域邏輯不自己讀時鐘。
_Avoid_: 系統時間、current time、timestamp(泛稱)

**借期(Loan period)**:
借書到到期的長度,目前固定 14 天。
_Avoid_: 期限、租期、duration

**借期政策(Loan policy)**:
決定借期長度的規則,只在借書那一刻被查一次;之後改政策不影響既有紀錄。
_Avoid_: 設定、config、rule table

**到期時刻(Due at)**:
借書當下用借期算好、寫死在借閱紀錄上的時刻快照;還書時只讀不重算。是一個時刻不是一個日曆日。
_Avoid_: 到期日、deadline、expiry

**逾期天數(Overdue days)**:
還書時刻超過到期時刻的完整天數(每 86400 秒算一天,未滿不算,永不為負),純 UTC 秒差、不看日曆日與假日。歸還時押在紀錄上;未歸還的紀錄可用「現在」現算。
_Avoid_: 罰款天數、late days、delay

## 契約遺留

`on_loan`(書的狀態值)與 `loan_policies`(借期政策的儲存名)是 API / 資料契約已定的識別字,保留原樣;除此之外不再新造 `loan*` 名字。

## 單冊版的推論規則

「一人同一本書只能有一筆未歸還」在一書一冊之下由「書 `on_loan` 就不能借」順帶滿足,不是獨立規則;多副本版才需要獨立實作。
