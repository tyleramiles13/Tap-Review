const draftBtn = document.getElementById("draftBtn");
const copyBtn = document.getElementById("copyBtn");
const reviewText = document.getElementById("reviewText");
const statusNote = document.getElementById("statusNote");

draftBtn.addEventListener("click", () => {
  draftBtn.disabled = true;
  draftBtn.innerText = "Drafting review...";

  // Fake AI (for now)
  setTimeout(() => {
    reviewText.value =
      "Will did an amazing job detailing my vehicle at Royal Detailing. He was professional, thorough, and clearly takes pride in his work. My car looks brand new and I would absolutely recommend Will and Royal Detailing.";

    draftBtn.disabled = false;
    draftBtn.innerText = "Draft review with AI";
    statusNote.innerText = "Review drafted. You can edit it if you want.";
  }, 600);
});

copyBtn.addEventListener("click", async () => {
  const text = reviewText.value.trim();

  if (!text) {
    statusNote.innerText = "Nothing to copy yet.";
    return;
  }

  try {
    await navigator.clipboard.writeText(text);

    copyBtn.innerText = "Copied ✓";
    statusNote.innerText = "Review copied to clipboard.";

    setTimeout(() => {
      copyBtn.innerText = "Copy review";
    }, 2000);

  } catch (err) {
    statusNote.innerText = "Copy failed. Please select and copy manually.";
  }
});



