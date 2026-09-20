const $ = (selector) => document.querySelector(selector);
const types = ["book", "audiobook", "movie", "anime", "drama", "variety", "game"];
const token = localStorage.getItem("media-token") || "";
$("#token").value = token;
$("#auth-note").textContent = "Cognito JWTを入力して保存するとAPIを利用できます。";

types.forEach((type) => {
  $("#type").insertAdjacentHTML("beforeend", `<option>${type}</option>`);
  $("select[name=type]").insertAdjacentHTML("beforeend", `<option>${type}</option>`);
});

$("#save-token").onclick = () => {
  localStorage.setItem("media-token", $("#token").value);
  load();
};

const headers = () =>
  $("#token").value ? { Authorization: `Bearer ${$("#token").value}` } : {};

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...headers(),
      ...(options.headers || {}),
    },
  });
  const body = await response.json();
  if (!response.ok) throw Error(body.error || response.statusText);
  return body;
}

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (character) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
      character
    ]
  );

async function load() {
  try {
    const query = new URLSearchParams({
      keyword: $("#keyword").value,
      type: $("#type").value,
    });
    const data = await api(`/api/media?${query}`);
    $("#list").innerHTML =
      data.media
        .map(
          (media) => `<article>
            <h2>${esc(media.title)}</h2>
            <small>${esc(media.type)} ${esc(media.creator || "")}</small>
            <p>${esc(media.review || "")}</p>
            ${
              /^https:\/\//i.test(media.image || "")
                ? `<img src="${esc(media.image)}" alt="">`
                : ""
            }
            <button data-edit="${esc(media.id)}">編集</button>
            <button data-delete="${esc(media.id)}">削除</button>
          </article>`
        )
        .join("") || "<p>記録はありません</p>";
  } catch (error) {
    $("#list").textContent = error.message;
  }
}

let editing;
function show(record = {}) {
  editing = record.id;
  $("#editor").hidden = false;
  $("#form-title").textContent = editing ? "編集" : "追加";
  Object.entries(record).forEach(([key, value]) => {
    const element = $(`[name=${key}]`);
    if (element) element.value = value;
  });
}

$("#add").onclick = () => show();
$("#cancel").onclick = () => {
  $("#editor").hidden = true;
};
$("#search").onclick = load;

$("#editor").onsubmit = async (event) => {
  event.preventDefault();
  const value = Object.fromEntries(new FormData(event.target));
  try {
    await api(editing ? `/api/media/${editing}` : "/api/media", {
      method: editing ? "PATCH" : "POST",
      body: JSON.stringify(value),
    });
    event.target.reset();
    event.target.hidden = true;
    await load();
  } catch (error) {
    alert(error.message);
  }
};

$("#list").onclick = async (event) => {
  if (event.target.dataset.delete) {
    if (!confirm("削除しますか？")) return;
    try {
      await api(`/api/media/${event.target.dataset.delete}`, { method: "DELETE" });
      await load();
    } catch (error) {
      alert(error.message);
    }
  } else if (event.target.dataset.edit) {
    show(await api(`/api/media/${event.target.dataset.edit}`));
  }
};

load();
