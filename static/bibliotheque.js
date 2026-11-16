"use strict";

/* ============================================================
   PromptHub - bibliotheque.js
   Page réservée aux membres connectés (voir page_bibliotheque dans app.py).
   1. Constantes            2. Éléments de la page   3. Thème clair/sombre
   4. Appels au serveur     5. Session et compte     6. Liste des prompts
   7. Étoiles et favoris    8. Publier / modifier     9. Commentaires et votes
   10. Démarrage
   ============================================================ */

// ---------- 1. Constantes ----------
const URL_PROMPTS = "/api/prompts";
const URL_COMMENTAIRES = "/api/commentaires";
const URL_SESSION = "/api/session";
const URL_DECONNEXION = "/api/deconnexion";
const CLE_THEME = "prompthub-theme";

// ---------- 2. Éléments de la page ----------
const boutonTheme = document.getElementById("bouton-theme");
const nomUtilisateurAffiche = document.getElementById("nom-utilisateur-affiche");
const badgeAdmin = document.getElementById("badge-admin");
const boutonDeconnexion = document.getElementById("bouton-deconnexion");
const boutonNouveauPrompt = document.getElementById("bouton-nouveau-prompt");
const onglets = document.querySelectorAll(".onglet");

const champRecherche = document.getElementById("recherche");
const filtreCategorie = document.getElementById("filtre-categorie");
const filtreTag = document.getElementById("filtre-tag");
const messageListe = document.getElementById("message-liste");
const grille = document.getElementById("grille-prompts");

const modalePrompt = document.getElementById("modale-prompt");
const modalePromptFond = document.getElementById("modale-prompt-fond");
const boutonFermerPrompt = document.getElementById("bouton-fermer-prompt");
const titreModalePrompt = document.getElementById("titre-modale-prompt");
const formulairePrompt = document.getElementById("formulaire-prompt");
const promptTitre = document.getElementById("prompt-titre");
const promptCategorie = document.getElementById("prompt-categorie");
const promptTags = document.getElementById("prompt-tags");
const promptContenu = document.getElementById("prompt-contenu");
const boutonValiderPrompt = document.getElementById("bouton-valider-prompt");
const messagePrompt = document.getElementById("message-prompt");

const modaleCommentaires = document.getElementById("modale-commentaires");
const modaleCommentairesFond = document.getElementById("modale-commentaires-fond");
const boutonFermerCommentaires = document.getElementById("bouton-fermer-commentaires");
const titreModaleCommentaires = document.getElementById("titre-modale-commentaires");
const listeCommentaires = document.getElementById("liste-commentaires");
const formulaireCommentaire = document.getElementById("formulaire-commentaire");
const commentaireTexte = document.getElementById("commentaire-texte");
const messageCommentaire = document.getElementById("message-commentaire");

// Onglet actif ("tous", "mes-prompts" ou "favoris", voir les boutons .onglet).
let ongletActif = "tous";
// Id du prompt en cours de modification, ou null si on est en train d'en publier un.
let promptEnEdition = null;
// Le prompt (et le bouton 💬 de sa carte) dont la fenêtre de commentaires est ouverte.
let promptCommentairesOuvert = null;
let boutonCommentairesOuvert = null;

// ---------- 3. Thème clair / sombre ----------
function lireThemeSauvegarde() {
    try {
        return localStorage.getItem(CLE_THEME);
    } catch (erreur) {
        return null;
    }
}

function sauvegarderTheme(theme) {
    try {
        localStorage.setItem(CLE_THEME, theme);
    } catch (erreur) {
        // Si le navigateur refuse, ce n'est pas grave : le thème ne sera pas retenu.
    }
}

function appliquerTheme(theme) {
    document.documentElement.dataset.theme = theme;
    boutonTheme.textContent = theme === "dark" ? "Mode clair" : "Mode sombre";
}

boutonTheme.addEventListener("click", () => {
    const nouveauTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    appliquerTheme(nouveauTheme);
    sauvegarderTheme(nouveauTheme);
});

// ---------- 4. Appels au serveur ----------
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

function creerBouton(texte, classes) {
    const bouton = document.createElement("button");
    bouton.type = "button";
    bouton.className = classes;
    bouton.textContent = texte;
    return bouton;
}

async function copierPrompt(texte, bouton) {
    const ancienTexte = bouton.textContent;
    try {
        await navigator.clipboard.writeText(texte);
        bouton.textContent = "Copié ✓";
    } catch (erreur) {
        bouton.textContent = "Échec";
    }
    setTimeout(() => {
        bouton.textContent = ancienTexte;
    }, 1500);
}

// ---------- 5. Session et compte ----------
// Cette page est déjà réservée aux connectés côté serveur (voir page_bibliotheque) :
// si jamais la session a expiré entre-temps, on renvoie simplement vers la connexion.
async function chargerSession() {
    try {
        const etat = await appelerApi(URL_SESSION);
        if (!etat.nom_utilisateur) {
            window.location.href = "/connexion";
            return;
        }
        nomUtilisateurAffiche.textContent = etat.nom_utilisateur;
        badgeAdmin.hidden = !etat.est_admin;
    } catch (erreur) {
        window.location.href = "/connexion";
    }
}

boutonDeconnexion.addEventListener("click", async () => {
    boutonDeconnexion.disabled = true;
    try {
        await appelerApi(URL_DECONNEXION, { method: "POST" });
        window.location.href = "/";
    } catch (erreur) {
        boutonDeconnexion.disabled = false;
    }
});

// ---------- 6. Liste des prompts ----------
// Numéro de la dernière recherche : évite d'afficher une vieille réponse qui
// arriverait après une plus récente.
let numeroRequete = 0;

async function chargerPrompts() {
    numeroRequete += 1;
    const numero = numeroRequete;

    const parametres = new URLSearchParams();
    const recherche = champRecherche.value.trim();
    if (recherche) {
        parametres.set("q", recherche);
    }
    if (filtreCategorie.value) {
        parametres.set("categorie", filtreCategorie.value);
    }
    const tag = filtreTag.value.trim();
    if (tag) {
        parametres.set("tag", tag);
    }
    if (ongletActif === "mes-prompts") {
        parametres.set("mes_prompts", "1");
    } else if (ongletActif === "favoris") {
        parametres.set("favoris", "1");
    }

    try {
        const prompts = await appelerApi(URL_PROMPTS + "?" + parametres.toString());
        if (numero !== numeroRequete) {
            return;
        }
        grille.replaceChildren(...prompts.map(creerCartePrompt));
        const mot = prompts.length > 1 ? "prompts trouvés" : "prompt trouvé";
        afficherMessage(messageListe, prompts.length + " " + mot, "");
    } catch (erreur) {
        if (numero !== numeroRequete) {
            return;
        }
        grille.replaceChildren();
        afficherMessage(messageListe, "Impossible de charger la bibliothèque : " + erreur.message, "erreur");
    }
}

function creerCartePrompt(prompt) {
    const carte = document.createElement("article");
    carte.className = "carte";

    const entete = document.createElement("div");
    entete.className = "carte-entete";
    const titre = document.createElement("h3");
    titre.textContent = prompt.titre;
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = prompt.categorie;
    entete.append(titre, badge);

    const contenu = document.createElement("p");
    contenu.className = "prompt-contenu";
    contenu.textContent = prompt.contenu;

    const auteur = document.createElement("p");
    auteur.className = "prompt-auteur";
    auteur.textContent = "Par " + prompt.auteur;

    carte.append(entete, contenu, auteur);

    if (prompt.tags.length > 0) {
        const conteneurTags = document.createElement("div");
        conteneurTags.className = "tags";
        prompt.tags.forEach((tag) => {
            const puce = creerBouton("#" + tag, "tag-puce");
            puce.addEventListener("click", () => {
                filtreTag.value = tag;
                chargerPrompts();
            });
            conteneurTags.append(puce);
        });
        carte.append(conteneurTags);
    }

    const moyenne = document.createElement("span");
    moyenne.className = "texte-doux petit";
    actualiserTexteMoyenne(moyenne, prompt);

    const etoiles = creerEtoiles(prompt, async (valeur) => {
        try {
            const resultat = await appelerApi(URL_PROMPTS + "/" + prompt.id + "/note", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ etoiles: valeur }),
            });
            prompt.ma_note = resultat.ma_note;
            prompt.nombre_notes = resultat.nombre_notes;
            prompt.moyenne_etoiles = resultat.moyenne_etoiles;
            marquerEtoiles(etoiles, prompt.ma_note);
            actualiserTexteMoyenne(moyenne, prompt);
        } catch (erreur) {
            afficherMessage(messageListe, "Erreur : " + erreur.message, "erreur");
        }
    });

    const notation = document.createElement("div");
    notation.className = "carte-notation";
    notation.append(etoiles, moyenne);
    carte.append(notation);

    const actions = document.createElement("div");
    actions.className = "carte-actions";

    const boutonCopier = creerBouton("Copier", "bouton bouton-discret");
    boutonCopier.addEventListener("click", () => copierPrompt(prompt.contenu, boutonCopier));

    const boutonFavori = creerBouton(
        "♥ " + prompt.nombre_favoris,
        "bouton bouton-like" + (prompt.est_favori ? " actif" : "")
    );
    boutonFavori.setAttribute("aria-label", "Mettre en favori le prompt " + prompt.titre);
    boutonFavori.addEventListener("click", () => basculerFavori(prompt.id, boutonFavori));

    const boutonCommentaires = creerBouton("💬 " + prompt.nombre_commentaires, "bouton bouton-discret");
    boutonCommentaires.addEventListener("click", () => ouvrirModaleCommentaires(prompt, boutonCommentaires));

    const boutonMessage = creerBouton("✉️ Message", "bouton bouton-discret");
    boutonMessage.addEventListener("click", () => {
        window.location.href = "/#messagerie";
    });

    actions.append(boutonCopier, boutonFavori, boutonCommentaires, boutonMessage);

    if (prompt.peut_modifier) {
        const boutonModifier = creerBouton("Modifier", "bouton bouton-discret");
        boutonModifier.addEventListener("click", () => ouvrirModalePrompt(prompt));

        const boutonSupprimer = creerBouton("Supprimer", "bouton bouton-discret bouton-danger");
        boutonSupprimer.addEventListener("click", () => supprimerPrompt(prompt.id));

        actions.append(boutonModifier, boutonSupprimer);
    }

    carte.append(actions);
    return carte;
}

let minuteurRecherche = null;
champRecherche.addEventListener("input", () => {
    clearTimeout(minuteurRecherche);
    minuteurRecherche = setTimeout(chargerPrompts, 300);
});

filtreCategorie.addEventListener("change", chargerPrompts);

let minuteurTag = null;
filtreTag.addEventListener("input", () => {
    clearTimeout(minuteurTag);
    minuteurTag = setTimeout(chargerPrompts, 300);
});

onglets.forEach((bouton) => {
    bouton.addEventListener("click", () => {
        onglets.forEach((autre) => {
            autre.classList.remove("actif");
            autre.setAttribute("aria-selected", "false");
        });
        bouton.classList.add("actif");
        bouton.setAttribute("aria-selected", "true");
        ongletActif = bouton.dataset.onglet;
        chargerPrompts();
    });
});

// ---------- 7. Étoiles et favoris ----------
function creerEtoiles(prompt, surNote) {
    const conteneur = document.createElement("div");
    conteneur.className = "etoiles";
    for (let valeur = 1; valeur <= 5; valeur += 1) {
        const etoile = document.createElement("button");
        etoile.type = "button";
        etoile.className = "etoile";
        etoile.textContent = "★";
        etoile.setAttribute("aria-label", valeur + " étoile" + (valeur > 1 ? "s" : ""));
        etoile.addEventListener("click", () => surNote(valeur));
        conteneur.append(etoile);
    }
    marquerEtoiles(conteneur, prompt.ma_note);
    return conteneur;
}

function marquerEtoiles(conteneur, maNote) {
    [...conteneur.children].forEach((etoile, index) => {
        etoile.classList.toggle("pleine", Boolean(maNote) && index < maNote);
    });
}

function actualiserTexteMoyenne(element, prompt) {
    element.textContent = prompt.moyenne_etoiles !== null
        ? prompt.moyenne_etoiles + " ★ (" + prompt.nombre_notes + ")"
        : "Pas encore noté";
}

async function basculerFavori(id, bouton) {
    bouton.disabled = true;
    try {
        const resultat = await appelerApi(URL_PROMPTS + "/" + id + "/favori", { method: "POST" });
        bouton.textContent = "♥ " + resultat.nombre_favoris;
        bouton.classList.toggle("actif", resultat.est_favori);
    } catch (erreur) {
        afficherMessage(messageListe, "Erreur : " + erreur.message, "erreur");
    } finally {
        bouton.disabled = false;
    }
}

// ---------- 8. Publier / modifier un prompt ----------
function ouvrirModalePrompt(prompt) {
    promptEnEdition = prompt ? prompt.id : null;
    titreModalePrompt.textContent = prompt ? "Modifier le prompt" : "Publier un prompt";
    boutonValiderPrompt.textContent = prompt ? "Enregistrer" : "Publier";
    promptTitre.value = prompt ? prompt.titre : "";
    promptCategorie.value = prompt ? prompt.categorie : promptCategorie.options[0].value;
    promptTags.value = prompt ? prompt.tags.join(", ") : "";
    promptContenu.value = prompt ? prompt.contenu : "";
    afficherMessage(messagePrompt, "", "");
    modalePrompt.hidden = false;
    promptTitre.focus();
}

function fermerModalePrompt() {
    modalePrompt.hidden = true;
    promptEnEdition = null;
    formulairePrompt.reset();
}

boutonNouveauPrompt.addEventListener("click", () => ouvrirModalePrompt(null));
boutonFermerPrompt.addEventListener("click", fermerModalePrompt);
modalePromptFond.addEventListener("click", fermerModalePrompt);

formulairePrompt.addEventListener("submit", async (evenement) => {
    evenement.preventDefault();

    const tags = promptTags.value
        .split(",")
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0);

    const donnees = {
        titre: promptTitre.value.trim(),
        categorie: promptCategorie.value,
        tags: tags,
        contenu: promptContenu.value.trim(),
    };

    afficherMessage(messagePrompt, "Envoi en cours...", "");
    boutonValiderPrompt.disabled = true;

    try {
        if (promptEnEdition === null) {
            await appelerApi(URL_PROMPTS, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(donnees),
            });
        } else {
            await appelerApi(URL_PROMPTS + "/" + promptEnEdition, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(donnees),
            });
        }
        fermerModalePrompt();
        await chargerPrompts();
    } catch (erreur) {
        afficherMessage(messagePrompt, erreur.message, "erreur");
    } finally {
        boutonValiderPrompt.disabled = false;
    }
});

async function supprimerPrompt(id) {
    if (!window.confirm("Supprimer définitivement ce prompt ? Cette action est irréversible.")) {
        return;
    }
    try {
        await appelerApi(URL_PROMPTS + "/" + id, { method: "DELETE" });
        await chargerPrompts();
    } catch (erreur) {
        afficherMessage(messageListe, "Erreur : " + erreur.message, "erreur");
    }
}

// ---------- 9. Commentaires et votes ----------
function ouvrirModaleCommentaires(prompt, bouton) {
    promptCommentairesOuvert = prompt;
    boutonCommentairesOuvert = bouton;
    titreModaleCommentaires.textContent = "Commentaires — " + prompt.titre;
    formulaireCommentaire.reset();
    afficherMessage(messageCommentaire, "", "");
    modaleCommentaires.hidden = false;
    chargerCommentaires(prompt.id);
}

function fermerModaleCommentaires() {
    modaleCommentaires.hidden = true;
    promptCommentairesOuvert = null;
    boutonCommentairesOuvert = null;
}

boutonFermerCommentaires.addEventListener("click", fermerModaleCommentaires);
modaleCommentairesFond.addEventListener("click", fermerModaleCommentaires);

document.addEventListener("keydown", (evenement) => {
    if (evenement.key !== "Escape") {
        return;
    }
    if (!modalePrompt.hidden) {
        fermerModalePrompt();
    }
    if (!modaleCommentaires.hidden) {
        fermerModaleCommentaires();
    }
});

async function chargerCommentaires(promptId) {
    listeCommentaires.replaceChildren();
    try {
        const commentaires = await appelerApi(URL_PROMPTS + "/" + promptId + "/commentaires");
        if (commentaires.length === 0) {
            const vide = document.createElement("p");
            vide.className = "texte-doux petit";
            vide.textContent = "Aucun commentaire pour l'instant. Sois le premier !";
            listeCommentaires.append(vide);
        } else {
            listeCommentaires.append(...commentaires.map(creerCommentaireElement));
        }
    } catch (erreur) {
        afficherMessage(messageCommentaire, "Impossible de charger les commentaires : " + erreur.message, "erreur");
    }
}

function creerCommentaireElement(commentaire) {
    const element = document.createElement("div");
    element.className = "commentaire";

    const entete = document.createElement("div");
    entete.className = "commentaire-entete";
    const auteur = document.createElement("span");
    auteur.className = "commentaire-auteur";
    auteur.textContent = commentaire.auteur;
    const date = document.createElement("span");
    date.className = "texte-doux petit";
    date.textContent = commentaire.cree_le.slice(0, 16);
    entete.append(auteur, date);

    const texte = document.createElement("p");
    texte.className = "commentaire-texte";
    texte.textContent = commentaire.contenu;

    const actions = document.createElement("div");
    actions.className = "commentaire-actions";

    const boutonPour = creerBouton(
        "👍 " + commentaire.pour,
        "bouton bouton-discret petit-bouton" + (commentaire.mon_vote === 1 ? " actif" : "")
    );
    boutonPour.addEventListener("click", () => voterCommentaire(commentaire.id, 1));

    const boutonContre = creerBouton(
        "👎 " + commentaire.contre,
        "bouton bouton-discret petit-bouton" + (commentaire.mon_vote === -1 ? " actif" : "")
    );
    boutonContre.addEventListener("click", () => voterCommentaire(commentaire.id, -1));

    actions.append(boutonPour, boutonContre);

    if (commentaire.peut_supprimer) {
        const boutonSupprimer = creerBouton("Supprimer", "bouton bouton-discret bouton-danger petit-bouton");
        boutonSupprimer.addEventListener("click", () => supprimerCommentaire(commentaire.id));
        actions.append(boutonSupprimer);
    }

    element.append(entete, texte, actions);
    return element;
}

async function voterCommentaire(id, valeur) {
    try {
        await appelerApi(URL_COMMENTAIRES + "/" + id + "/vote", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ valeur: valeur }),
        });
        if (promptCommentairesOuvert) {
            chargerCommentaires(promptCommentairesOuvert.id);
        }
    } catch (erreur) {
        afficherMessage(messageCommentaire, "Erreur : " + erreur.message, "erreur");
    }
}

async function supprimerCommentaire(id) {
    if (!window.confirm("Supprimer ce commentaire ?")) {
        return;
    }
    try {
        await appelerApi(URL_COMMENTAIRES + "/" + id, { method: "DELETE" });
        if (promptCommentairesOuvert) {
            promptCommentairesOuvert.nombre_commentaires -= 1;
            if (boutonCommentairesOuvert) {
                boutonCommentairesOuvert.textContent = "💬 " + promptCommentairesOuvert.nombre_commentaires;
            }
            chargerCommentaires(promptCommentairesOuvert.id);
        }
    } catch (erreur) {
        afficherMessage(messageCommentaire, "Erreur : " + erreur.message, "erreur");
    }
}

formulaireCommentaire.addEventListener("submit", async (evenement) => {
    evenement.preventDefault();
    if (!promptCommentairesOuvert) {
        return;
    }

    const contenu = commentaireTexte.value.trim();
    afficherMessage(messageCommentaire, "Envoi en cours...", "");

    try {
        await appelerApi(URL_PROMPTS + "/" + promptCommentairesOuvert.id + "/commentaires", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ contenu: contenu }),
        });
        formulaireCommentaire.reset();
        afficherMessage(messageCommentaire, "", "");
        promptCommentairesOuvert.nombre_commentaires += 1;
        if (boutonCommentairesOuvert) {
            boutonCommentairesOuvert.textContent = "💬 " + promptCommentairesOuvert.nombre_commentaires;
        }
        chargerCommentaires(promptCommentairesOuvert.id);
    } catch (erreur) {
        afficherMessage(messageCommentaire, erreur.message, "erreur");
    }
});

// ---------- 10. Démarrage ----------
appliquerTheme(lireThemeSauvegarde() === "light" ? "light" : "dark");
chargerSession();
chargerPrompts();
