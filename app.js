const $ = (selector) =>
  document.querySelector(selector);


/* ---------------- HELPERS ---------------- */

function escapeHTML(value) {

  return String(value ?? "")
    .replace(
      /[&<>"']/g,
      (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
      })[character]
    );
}


async function request(url, options) {

  const response =
    await fetch(url, options);

  let data = {};

  try {
    data = await response.json();
  } catch {}

  return [response, data];
}


/* ---------------- QUOTES ---------------- */

const quotes = [

  "The best days become the stories we tell again.",

  "A little moment, a lifetime of meaning.",

  "Keep this one close.",

  "Some memories never need an ending.",

  "We were here. We laughed. We remembered.",

  "Proof that ordinary days can become extraordinary.",

  "One picture. A thousand little memories.",

  "This is the kind of day worth remembering."

];


function getQuote(memory) {

  const text =
    memory.title +
    memory.names;

  let number = 0;

  for (const character of text) {

    number +=
      character.charCodeAt(0);

  }

  return quotes[
    number % quotes.length
  ];
}


/* ---------------- MONTHS ---------------- */

const months = [

  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December"

];


/* ---------------- MEDIA ---------------- */

function firstMedia(memory) {

  return (
    memory.files.find(
      (file) =>
        file.mime.startsWith("image/")
    ) ||
    memory.files[0]
  );
}


function mediaHTML(memory) {

  const file =
    firstMedia(memory);

  if (!file) {
    return "";
  }


  if (
    file.mime.startsWith("video/")
  ) {

    return `
      <video
        muted
        preload="metadata"
        src="${file.url}"
      ></video>
    `;

  }


  return `
    <img
      loading="lazy"
      src="${file.url}"
      alt="${escapeHTML(memory.title)}"
    >
  `;
}


/* ---------------- RENDER TIMELINE ---------------- */

async function renderTimeline() {

  const [
    response,
    memories
  ] = await request(
    "/api/memories"
  );


  const root =
    $("#timelineRoot");


  if (!response.ok) {

    root.innerHTML = `
      <div class="empty">
        Unable to load memories.
      </div>
    `;

    return;
  }


  if (!memories.length) {

    root.innerHTML = `
      <div class="empty">

        <strong>
          The first page is blank.
        </strong>

        Be the one who fills it.

      </div>
    `;

    $("#summary").textContent =
      "0 approved memories";

    return;
  }


  $("#summary").textContent =
    `${memories.length} approved memories • arranged automatically by date`;


  const years = {};


  for (const memory of memories) {

    if (!years[memory.year]) {

      years[memory.year] = [];

    }

    years[memory.year].push(memory);

  }


  const sortedYears =
    Object.keys(years)
      .sort(
        (a, b) =>
          Number(b) - Number(a)
      );


  root.innerHTML =
    sortedYears
      .map((year) => {

        const yearMemories =
          years[year];


        const groupedMonths = {};


        for (
          const memory
          of yearMemories
        ) {

          if (
            !groupedMonths[
              memory.month
            ]
          ) {

            groupedMonths[
              memory.month
            ] = [];

          }

          groupedMonths[
            memory.month
          ].push(memory);

        }


        const monthHTML =
          Object.keys(
            groupedMonths
          )
            .sort(
              (a, b) =>
                Number(b) -
                Number(a)
            )
            .map((month) => {

              const monthMemories =
                groupedMonths[month];


              return `

                <div class="month">

                  <div class="month-title">

                    ${months[
                      Number(month) - 1
                    ]}

                  </div>


                  <div class="grid">

                    ${monthMemories
                      .map(
                        (memory) => `

                      <article
                        class="memory"
                        data-id="${escapeHTML(memory.id)}"
                      >

                        <div class="media">

                          ${mediaHTML(memory)}

                          <span class="badge">

                            ${String(
                              memory.day
                            ).padStart(2, "0")}

                            /

                            ${String(
                              memory.month
                            ).padStart(2, "0")}

                            /

                            ${memory.year}

                          </span>

                        </div>


                        <div class="memory-info">

                          <h4>
                            ${escapeHTML(
                              memory.title
                            )}
                          </h4>


                          <p>
                            ${escapeHTML(
                              memory.story ||
                              "A moment worth keeping."
                            )}
                          </p>


                          <p class="names">

                            ${escapeHTML(
                              memory.names
                            )}

                          </p>


                          <p class="quote">

                            “${escapeHTML(
                              getQuote(memory)
                            )}”

                          </p>

                        </div>

                      </article>

                    `
                      )
                      .join("")}

                  </div>

                </div>

              `;

            })
            .join("");


        return `

          <section class="year">

            <div class="year-head">

              <h3>
                ${escapeHTML(year)}
              </h3>

              <span>
                ${yearMemories.length}
                memories
              </span>

            </div>

            ${monthHTML}

          </section>

        `;

      })
      .join("");
}


/* ---------------- MEMORY VIEWER ---------------- */

$("#timelineRoot")
  .addEventListener(
    "click",
    async (event) => {

      const card =
        event.target.closest(
          ".memory"
        );


      if (!card) {
        return;
      }


      const [
        response,
        memories
      ] = await request(
        "/api/memories"
      );


      if (!response.ok) {
        return;
      }


      const memory =
        memories.find(
          (item) =>
            item.id ===
            card.dataset.id
        );


      if (!memory) {
        return;
      }


      const media =
        memory.files
          .map((file) => {

            if (
              file.mime.startsWith(
                "image/"
              )
            ) {

              return `
                <img
                  src="${file.url}"
                  alt="${escapeHTML(
                    memory.title
                  )}"
                >
              `;

            }


            return `
              <video
                controls
                preload="metadata"
                src="${file.url}"
              ></video>
            `;

          })
          .join("");


      $("#lightboxContent")
        .innerHTML = `

          <h3>
            ${escapeHTML(
              memory.title
            )}
          </h3>


          <p>

            ${escapeHTML(
              memory.names
            )}

            ·

            ${memory.day}/
            ${memory.month}/
            ${memory.year}

          </p>


          <div class="light-grid">

            ${media}

          </div>


          <p>

            “${escapeHTML(
              getQuote(memory)
            )}”

          </p>

        `;


      $("#lightbox").showModal();

    }
  );


/* ---------------- CLOSE BUTTONS ---------------- */

document
  .querySelectorAll(
    "[data-close]"
  )
  .forEach((button) => {

    button.onclick = () => {

      button
        .closest("dialog")
        .close();

    };

  });


/* ---------------- SUBMIT ---------------- */

$("#submitBtn")
  .onclick = () => {

    $("#submitDialog")
      .showModal();

  };


$("#submitForm")
  .addEventListener(
    "submit",
    async (event) => {

      event.preventDefault();


      $("#submitError")
        .textContent = "";


      const form =
        event.currentTarget;


      const formData =
        new FormData(form);


      const [
        response,
        data
      ] = await request(
        "/api/memories",
        {
          method: "POST",

          body: formData
        }
      );


      if (!response.ok) {

        $("#submitError")
          .textContent =
            data.error ||
            "Upload failed.";

        return;
      }


      form.reset();


      $("#submitDialog")
        .close();


      alert(
        "Your memory was submitted. The Keeper will approve it before it appears publicly."
      );

    }
  );


/* ---------------- ADMIN ---------------- */

$("#adminBtn")
  .onclick = async () => {

    const [
      response,
      me
    ] = await request(
      "/api/me"
    );


    if (
      response.ok &&
      me.admin
    ) {

      openAdmin();

      return;

    }


    const password =
      prompt(
        "Keeper password:"
      );


    if (password === null) {
      return;
    }


    const [
      loginResponse,
      loginData
    ] = await request(
      "/api/login",
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json"
        },

        body: JSON.stringify({
          password
        })
      }
    );


    if (!loginResponse.ok) {

      alert(
        loginData.error ||
        "Login failed."
      );

      return;
    }


    openAdmin();

  };


async function openAdmin() {

  const [
    response,
    pending
  ] = await request(
    "/api/pending"
  );


  if (!response.ok) {

    alert(
      "Unable to open Keeper vault."
    );

    return;
  }


  const area =
    $("#adminArea");


  if (!pending.length) {

    area.innerHTML = `

      <p class="hint">

        No pending submissions.
        The garden is caught up.

      </p>

      <button
        class="dark"
        id="logout"
      >
        Lock the vault
      </button>

    `;

  } else {

    area.innerHTML =

      pending
        .map(
          (memory) => `

          <div class="pending">

            <h4>
              ${escapeHTML(
                memory.title
              )}
            </h4>

            <p>

              ${escapeHTML(
                memory.names
              )}

              ·

              ${memory.day}/
              ${memory.month}/
              ${memory.year}

              ·

              ${memory.files.length}
              files

            </p>

            <button
              class="approve"
              data-approve="${escapeHTML(
                memory.id
              )}"
            >
              Approve
            </button>

          </div>

        `
        )
        .join("") +

      `

        <br>

        <button
          class="dark"
          id="logout"
        >
          Lock the vault
        </button>

      `;

  }


  area
    .querySelectorAll(
      "[data-approve]"
    )
    .forEach((button) => {

      button.onclick =
        async () => {

          await fetch(
            "/api/memories/" +
              encodeURIComponent(
                button.dataset.approve
              ) +
              "/approve",
            {
              method: "POST"
            }
          );


          openAdmin();

          renderTimeline();

        };

    });


  $("#logout").onclick =
    async () => {

      await fetch(
        "/api/logout",
        {
          method: "POST"
        }
      );


      $("#adminDialog")
        .close();

    };


  $("#adminDialog")
    .showModal();

}


/* ---------------- START ---------------- */

renderTimeline();