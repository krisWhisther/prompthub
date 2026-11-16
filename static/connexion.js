"use strict";

/* ============================================================
   PromptHub - connexion.js
   1. Constantes   2. Éléments de la page   3. Appel au serveur
   4. Validation (miroir du serveur)   5. Panneau à bascule
   6. Afficher / masquer le mot de passe   7. Connexion   8. Inscription
   9. Mot de passe oublié (fenêtre modale)
   10. Vérification de l'e-mail (fenêtre modale)
   ============================================================ */

// ---------- 1. Constantes ----------
const URL_CONNEXION = "/api/connexion";
const URL_INSCRIPTION = "/api/inscription";
const URL_MOT_DE_PASSE_OUBLIE = "/api/mot-de-passe-oublie";
const URL_VERIFIER_EMAIL = "/api/verifier-email";
const URL_RENVOYER_CODE = "/api/renvoyer-code-verification";
const CLE_REDIRECTION = "prompthub-apres-connexion";

// ---------- 2. Éléments de la page ----------
const conteneur = document.getElementById("container");
const boutonVersInscription = document.getElementById("bouton-vers-inscription");
const boutonVersConnexion = document.getElementById("bouton-vers-connexion");

const formulaireConnexion = document.getElementById("formulaire-connexion");
const loginIdentifiant = document.getElementById("login-identifiant");
const loginMotDePasse = document.getElementById("login-motdepasse");
const messageConnexion = document.getElementById("message-connexion");

const formulaireInscription = document.getElementById("formulaire-inscription");
const registerNom = document.getElementById("register-nom");
const registerPrenom = document.getElementById("register-prenom");
const registerEmail = document.getElementById("register-email");
const registerMotDePasse = document.getElementById("register-motdepasse");
const registerConfirmation = document.getElementById("register-confirmation");
const nomMessage = document.getElementById("nom-message");
const prenomMessage = document.getElementById("prenom-message");
const emailMessage = document.getElementById("email-message");
const motdepasseMessage = document.getElementById("motdepasse-message");
const confirmationMessage = document.getElementById("confirmation-message");
const messageInscription = document.getElementById("message-inscription");

const boutonMotDePasseOublie = document.getElementById("bouton-mot-de-passe-oublie");
const modaleOubli = document.getElementById("modale-oubli");
const modaleOubliFond = document.getElementById("modale-oubli-fond");
const boutonFermerOubli = document.getElementById("bouton-fermer-oubli");
const formulaireOubli = document.getElementById("formulaire-oubli");
const oubliEmail = document.getElementById("oubli-email");
const messageOubli = document.getElementById("message-oubli");

const modaleVerification = document.getElementById("modale-verification");
const texteModaleVerification = document.getElementById("texte-modale-verification");
const formulaireVerification = document.getElementById("formulaire-verification");
const codeVerification = document.getElementById("code-verification");
const boutonRenvoyerCode = document.getElementById("bouton-renvoyer-code");
const messageVerification = document.getElementById("message-verification");

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

// Envoie vers la page d'où le visiteur venait avant d'être redirigé ici
// (voir redirigerVersConnexion dans script.js), ou l'accueil par défaut.
function redirectionApresConnexion() {
    let destination = "/";
    try {
        destination = sessionStorage.getItem(CLE_REDIRECTION) || "/";
        sessionStorage.removeItem(CLE_REDIRECTION);
    } catch (erreur) {
        destination = "/";
    }
    window.location.href = destination;
}

// ---------- 4. Validation (miroir des règles du serveur, voir app.py) ----------
// Sert à la fois pour le nom et le prénom (mêmes règles côté serveur, voir
// nom_propre_valide dans app.py).
function nomValide(valeur) {
    if (valeur.length < 2 || valeur.length > 50) {
        return false;
    }
    return !/[0-9]/.test(valeur);
}

function emailValide(email) {
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

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

let minuteurApprobationMdp = null;
let minuteurApprobationConfirmation = null;

// Comme marquerChamp, mais spécifique au mot de passe : une fois valide, on
// affiche "Approuvé" un court instant puis on efface le message, au lieu de
// le laisser affiché en permanence.
function gererIndiceMotDePasse() {
    window.clearTimeout(minuteurApprobationMdp);

    if (registerMotDePasse.value === "") {
        registerMotDePasse.classList.remove("valide", "invalide");
        motdepasseMessage.textContent = "";
        motdepasseMessage.className = "indice";
        return;
    }

    const estValide = motDePasseValide(registerMotDePasse.value);
    registerMotDePasse.classList.toggle("valide", estValide);
    registerMotDePasse.classList.toggle("invalide", !estValide);

    if (!estValide) {
        motdepasseMessage.textContent = "8 caractères minimum, avec une majuscule, un chiffre et un symbole";
        motdepasseMessage.className = "indice erreur";
        return;
    }

    motdepasseMessage.textContent = "✅ Approuvé";
    motdepasseMessage.className = "indice ok";
    minuteurApprobationMdp = window.setTimeout(() => {
        motdepasseMessage.textContent = "";
        motdepasseMessage.className = "indice";
    }, 1500);
}

// Même principe que gererIndiceMotDePasse, pour la confirmation.
function gererIndiceConfirmation() {
    window.clearTimeout(minuteurApprobationConfirmation);

    if (registerConfirmation.value === "") {
        registerConfirmation.classList.remove("valide", "invalide");
        confirmationMessage.textContent = "";
        confirmationMessage.className = "indice";
        return;
    }

    const estValide = registerMotDePasse.value === registerConfirmation.value;
    registerConfirmation.classList.toggle("valide", estValide);
    registerConfirmation.classList.toggle("invalide", !estValide);

    if (!estValide) {
        confirmationMessage.textContent = "Les mots de passe ne correspondent pas";
        confirmationMessage.className = "indice erreur";
        return;
    }

    confirmationMessage.textContent = "✅ Approuvé";
    confirmationMessage.className = "indice ok";
    minuteurApprobationConfirmation = window.setTimeout(() => {
        confirmationMessage.textContent = "";
        confirmationMessage.className = "indice";
    }, 1500);
}

registerNom.addEventListener("input", () => {
    marquerChamp(registerNom, nomMessage, nomValide(registerNom.value.trim()), "");
});

registerPrenom.addEventListener("input", () => {
    marquerChamp(registerPrenom, prenomMessage, nomValide(registerPrenom.value.trim()), "");
});

registerEmail.addEventListener("input", () => {
    marquerChamp(registerEmail, emailMessage, emailValide(registerEmail.value.trim()), "Un code de confirmation te sera envoyé à cette adresse");
});

registerMotDePasse.addEventListener("input", () => {
    gererIndiceMotDePasse();
    gererIndiceConfirmation();
});

registerConfirmation.addEventListener("input", () => {
    gererIndiceConfirmation();
});

// État initial au chargement de la page : les champs sont vides, donc ces
// deux appels effacent le texte statique écrit en dur dans le HTML (sinon
// il resterait affiché tant qu'aucun événement "input" n'a eu lieu).
gererIndiceMotDePasse();
gererIndiceConfirmation();

// ---------- 5. Panneau à bascule ----------
boutonVersInscription.addEventListener("click", () => {
    conteneur.classList.add("active");
});

boutonVersConnexion.addEventListener("click", () => {
    conteneur.classList.remove("active");
});

// ---------- 6. Afficher / masquer le mot de passe ----------
document.querySelectorAll(".bascule-mdp").forEach((bouton) => {
    bouton.addEventListener("click", () => {
        const champ = document.getElementById(bouton.dataset.cible);
        const visible = champ.type === "text";
        champ.type = visible ? "password" : "text";
        bouton.textContent = visible ? "Afficher le mot de passe" : "Masquer le mot de passe";
    });
});

// ---------- 7. Connexion ----------
formulaireConnexion.addEventListener("submit", async (evenement) => {
    evenement.preventDefault();

    const donnees = {
        identifiant: loginIdentifiant.value.trim(),
        mot_de_passe: loginMotDePasse.value,
    };

    afficherMessage(messageConnexion, "Connexion en cours...", "");

    try {
        await appelerApi(URL_CONNEXION, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(donnees),
        });
        afficherMessage(messageConnexion, "Connecté !", "ok");
        redirectionApresConnexion();
    } catch (erreur) {
        afficherMessage(messageConnexion, erreur.message, "erreur");
    }
});

// ---------- 8. Inscription ----------
formulaireInscription.addEventListener("submit", async (evenement) => {
    evenement.preventDefault();

    const nom = registerNom.value.trim();
    const prenom = registerPrenom.value.trim();
    const email = registerEmail.value.trim();
    const motDePasse = registerMotDePasse.value;
    const confirmation = registerConfirmation.value;

    const nomOk = nomValide(nom);
    const prenomOk = nomValide(prenom);
    const emailOk = emailValide(email);
    const motDePasseOk = motDePasseValide(motDePasse);
    const confirmationOk = confirmation !== "" && motDePasse === confirmation;

    marquerChamp(registerNom, nomMessage, nomOk, "");
    marquerChamp(registerPrenom, prenomMessage, prenomOk, "");
    marquerChamp(registerEmail, emailMessage, emailOk, "Un code de confirmation te sera envoyé à cette adresse");
    gererIndiceMotDePasse();
    gererIndiceConfirmation();

    if (!nomOk || !prenomOk || !emailOk || !motDePasseOk || !confirmationOk) {
        afficherMessage(messageInscription, "Corrige les champs en rouge avant de continuer.", "erreur");
        return;
    }

    afficherMessage(messageInscription, "Création du compte...", "");

    try {
        const donnees = await appelerApi(URL_INSCRIPTION, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ nom: nom, prenom: prenom, email: email, mot_de_passe: motDePasse }),
        });
        afficherMessage(messageInscription, "Compte créé !", "ok");
        ouvrirModaleVerification(email, donnees.nom_utilisateur);
    } catch (erreur) {
        afficherMessage(messageInscription, erreur.message, "erreur");
    }
});

// ---------- 9. Mot de passe oublié (fenêtre modale) ----------
function ouvrirModaleOubli() {
    modaleOubli.hidden = false;
    messageOubli.textContent = "";
    messageOubli.className = "message";
    oubliEmail.value = "";
    oubliEmail.focus();
}

function fermerModaleOubli() {
    modaleOubli.hidden = true;
}

boutonMotDePasseOublie.addEventListener("click", ouvrirModaleOubli);
boutonFermerOubli.addEventListener("click", fermerModaleOubli);
modaleOubliFond.addEventListener("click", fermerModaleOubli);

document.addEventListener("keydown", (evenement) => {
    if (evenement.key === "Escape" && !modaleOubli.hidden) {
        fermerModaleOubli();
    }
});

formulaireOubli.addEventListener("submit", async (evenement) => {
    evenement.preventDefault();

    const email = oubliEmail.value.trim();
    if (!emailValide(email)) {
        afficherMessage(messageOubli, "Adresse e-mail invalide.", "erreur");
        return;
    }

    afficherMessage(messageOubli, "Envoi en cours...", "");

    try {
        const donnees = await appelerApi(URL_MOT_DE_PASSE_OUBLIE, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email: email }),
        });
        afficherMessage(messageOubli, donnees.message, "ok");
    } catch (erreur) {
        afficherMessage(messageOubli, erreur.message, "erreur");
    }
});

// ---------- 10. Vérification de l'e-mail (après l'inscription) ----------
// Pas de bouton pour fermer cette modale (ni clic sur le fond, ni touche Échap) :
// le compte existe déjà et la session est ouverte (voir inscription() dans app.py),
// mais l'inscription n'est "complète" qu'une fois le code confirmé.
//
// pseudoInscrit mémorise le pseudo généré à l'inscription, pour pouvoir l'afficher
// une fois l'e-mail confirmé (formulaireVerification ci-dessous) : c'est la seule
// fois où la personne le voit avant de s'en servir pour se connecter.
let pseudoInscrit = "";

function ouvrirModaleVerification(email, pseudo) {
    pseudoInscrit = pseudo || "";
    texteModaleVerification.textContent =
        "Un code à 6 chiffres vient d'être envoyé à " + email + ". Saisis-le ci-dessous pour terminer ton inscription. " +
        "Ton pseudo pour te connecter : " + pseudoInscrit + ".";
    messageVerification.textContent = "";
    messageVerification.className = "message";
    codeVerification.value = "";
    modaleVerification.hidden = false;
    codeVerification.focus();
}

formulaireVerification.addEventListener("submit", async (evenement) => {
    evenement.preventDefault();

    const code = codeVerification.value.trim();
    afficherMessage(messageVerification, "Vérification en cours...", "");

    try {
        await appelerApi(URL_VERIFIER_EMAIL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code: code }),
        });
        afficherMessage(messageVerification, "E-mail confirmé ! Ton pseudo est " + pseudoInscrit + ". Redirection...", "ok");
        window.setTimeout(redirectionApresConnexion, 1800);
    } catch (erreur) {
        afficherMessage(messageVerification, erreur.message, "erreur");
    }
});

boutonRenvoyerCode.addEventListener("click", async () => {
    afficherMessage(messageVerification, "Envoi en cours...", "");

    try {
        const donnees = await appelerApi(URL_RENVOYER_CODE, { method: "POST" });
        afficherMessage(messageVerification, donnees.message, "ok");
    } catch (erreur) {
        afficherMessage(messageVerification, erreur.message, "erreur");
    }
});
