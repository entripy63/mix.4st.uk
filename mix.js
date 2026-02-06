let aud = document.getElementById("audioPlayer");
let autoAdvance = document.getElementById("autoAdvance");

if (autoAdvance) {
  autoAdvance.disabled = false;

  // Restore autoAdvance state from session storage, default to checked
  if (sessionStorage.getItem("autoAdvance") !== null) {
    autoAdvance.checked = sessionStorage.getItem("autoAdvance") === "true";
  } else {
    autoAdvance.checked = true;
  }

  // Save autoAdvance state when changed
  autoAdvance.addEventListener("change", function() {
    sessionStorage.setItem("autoAdvance", autoAdvance.checked);
  });

  aud.addEventListener("ended", function() {
    if (autoAdvance.checked) {
      let laterMix = document.getElementById("laterMix").href;
      window.location.href = laterMix;
    }
  });
}

// Restore volume from storage
if (localStorage.getItem("mixVolume")) {
  aud.volume = parseFloat(localStorage.getItem("mixVolume"));
}

// Save volume when changed
aud.addEventListener("volumechange", function() {
  localStorage.setItem("mixVolume", aud.volume);
});
