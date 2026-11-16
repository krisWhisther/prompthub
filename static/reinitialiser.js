"use strict";

/* ============================================================
   PromptHub - reinitialiser.js
   1. Constantes   2. Éléments de la page   3. Appel au serveur
   4. Validation (miroir du serveur)   5. Afficher / masquer le mot de passe
   6. Envoi du nouveau mot de passe
   ============================================================ */

// ---------- 1. Constantes ----------
const URL_REINITIALISER = "/api/reinitialiser";

// ---------- 2. Éléments de la page ----------
// Absents si le lien n'est plus valable (voir reinitialiser.html) : dans ce cas,
// le formulaire n'existe pas et ce script ne fait rien (voir le "if" plus bas).
const formulaireReinitialiser = document.getElementById("formulaire-reinitialiser");

if (formulaireReinitialiser) {
  const champJeton = document.getElementById("jeton");
  const nouveauMotDePasse = document.getElementById("nouveau-motdepasse");
  const nouvelleConfirmation = document.getElementById("nouvelle-confirmation");
  const motdepasseMessage = document.getElementById("motdepasse-message");
  const confirmationMessage = document.getElementById("confirmation-message");
  const messageReinitialiser = document.getElementById("message-reinitialiser");

  // ---------- 3. Appel au serveur ----------
  // Envoie une requête et renvoie les données JSON.
  // Si le serveur répond par une erreur, on lance une Error avec son message.
  async function appelerApi(url, options) {
    const reponse = await fetch(url, options);

    let donnees = null;
    try {
      donnees = await reponse.json();
    } catch (erreur) {
      donnees = null;
    }

    if (!reponse.ok) {
      const message = donnees && donnees.erreur ? donnees.erreur : "Erreur " + reponse.status;
      throw new Error(message);
    }
    return donnees;
  }

  function afficherMessage(element, texte, type) {
    element.textContent = texte;
    element.className = type ? "message " + type : "message";
  }

  // ---------- 4. Validation (miroir des règles du serveur, voir app.py) ----------
  function motDePasseValide(motDePasse) {
    if (motDePasse.length < 8) {
      return false;
    }
    const aMajuscule = /[A-Z]/.test(motDePasse);
    const aChiffre = /[0-9]/.test(motDePasse);
    const aSymbole = /[^A-Za-z0-9]/.test(motDePasse);
    return aMajuscule && aChiffre && aSymbole;
  }

  // Marque un champ comme valide/invalide et met à jour son indice. Un champ vide
  // n'est ni l'un ni l'autre : on laisse l'indice neutre plutôt que d'afficher une
  // erreur avant même que la personne ait commencé à taper.
  function marquerChamp(champ, indice, estValide, texteParDefaut) {
    if (champ.value === "") {
      champ.classList.remove("valide", "invalide");
      indice.textContent = texteParDefaut;
      indice.className = "indice";
      return;
    }
    champ.classList.toggle("valide", estValide);
    champ.classList.toggle("invalide", !estValide);
    indice.textContent = texteParDefaut;
    indice.className = estValide ? "indice ok" : "indice erreur";
  }

  nouveauMotDePasse.addEventListener("input", () => {
    marquerChamp(nouveauMotDePasse, motdepasseMessage, motDePasseValide(nouveauMotDePasse.value), "8 caractères minimum, avec une majuscule, un chiffre et un symbole");
    marquerChamp(
      nouvelleConfirmation,
      confirmationMessage,
      nouvelleConfirmation.value !== "" && nouveauMotDePasse.value === nouvelleConfirmation.value,
      "Les mots de passe ne correspondent pas"
    );
  });

  nouvelleConfirmation.addEventListener("input", () => {
    marquerChamp(
      nouvelleConfirmation,
      confirmationMessage,
      nouvelleConfirmation.value !== "" && nouveauMotDePasse.value === nouvelleConfirmation.value,
      "Les mots de passe ne correspondent pas"
    );
  });

  // ---------- 5. Afficher / masquer le mot de passe ----------
  document.querySelectorAll(".bascule-mdp").forEach((bouton) => {
    bouton.addEventListener("click", () => {
      const champ = document.getElementById(bouton.dataset.cible);
      const visible = champ.type === "text";
      champ.type = visible ? "password" : "text";
      bouton.textContent = visible ? "Afficher le mot de passe" : "Masquer le mot de passe";
    });
  });

  // ---------- 6. Envoi du nouveau mot de passe ----------
  formulaireReinitialiser.addEventListener("submit", async (evenement) => {
    evenement.preventDefault();

    const motDePasse = nouveauMotDePasse.value;
    const confirmation = nouvelleConfirmation.value;

    const motDePasseOk = motDePasseValide(motDePasse);
    const confirmationOk = confirmation !== "" && motDePasse === confirmation;

    marquerChamp(nouveauMotDePasse, motdepasseMessage, motDePasseOk, "8 caractères minimum, avec une majuscule, un chiffre et un symbole");
    marquerChamp(nouvelleConfirmation, confirmationMessage, confirmationOk, "Les mots de passe ne correspondent pas");

    if (!motDePasseOk || !confirmationOk) {
      afficherMessage(messageReinitialiser, "Corrige les champs en rouge avant de continuer.", "erreur");
      return;
    }

    afficherMessage(messageReinitialiser, "Mise à jour en cours...", "");

    try {
      await appelerApi(URL_REINITIALISER, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jeton: champJeton.value, mot_de_passe: motDePasse }),
      });
      afficherMessage(messageReinitialiser, "Mot de passe mis à jour ! Redirection...", "ok");
      window.setTimeout(() => {
        window.location.href = "/connexion";
      }, 1200);
    } catch (erreur) {
      afficherMessage(messageReinitialiser, erreur.message, "erreur");
    }
  });
}
