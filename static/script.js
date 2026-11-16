"use strict";

/* ============================================================
   PromptHub - script.js
   1. Constantes   2. Éléments de la page   3. Thème clair/sombre
   4. Appels au serveur   5. Affichage   6. Actions
   7. Navigation (bande flottante, menu, compte)   8. Démarrage
   ============================================================ */

// ---------- 1. Constantes ----------
const URL_PROMPTS_APERCU = "/api/prompts/apercu";
const URL_STATS = "/api/stats";
const URL_SESSION = "/api/session";
const URL_DECONNEXION = "/api/deconnexion";
const URL_IDEE_JAVA = "http://127.0.0.1:8081/api/idee";
const CLE_THEME = "prompthub-theme";
const CLE_REDIRECTION = "prompthub-apres-connexion";
const SEUIL_SCROLL_ENTETE = 80;

// ---------- 2. Éléments de la page ----------
const boutonTheme = document.getElementById("bouton-theme");
const messageListe = document.getElementById("message-liste");
const grille = document.getElementById("grille-prompts");
const boutonIdee = document.getElementById("bouton-idee");
const texteIdee = document.getElementById("texte-idee");
const statTotal = document.getElementById("stat-total");
const statTop = document.getElementById("stat-top");
const statLikes = document.getElementById("stat-likes");

const barreNavigation = document.getElementById("entete");
const boutonMenu = document.getElementById("bouton-menu");
const menuNavigation = document.getElementById("menu-navigation");
const lienBibliotheque = document.getElementById("lien-bibliotheque");
const lienBibliothequeComplete = document.getElementById("lien-bibliotheque-complete");
const lienMessagerie = document.getElementById("lien-messagerie");
const lienConnexion = document.getElementById("lien-connexion");
const blocCompteEntete = document.getElementById("bloc-compte-entete");
const nomUtilisateurAffiche = document.getElementById("nom-utilisateur-affiche");
const badgeAdmin = document.getElementById("badge-admin");
const boutonDeconnexion = document.getElementById("bouton-deconnexion");

// Vrai une fois qu'on sait qu'un compte est connecté (voir chargerSession).
let connecte = false;

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

// ---------- 5. Affichage ----------
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

// Carte simplifiée pour l'aperçu de l'accueil : juste de quoi donner envie de
// rejoindre la bibliothèque complète (pas de favori/note/commentaire ici, voir
// templates/bibliotheque.html et static/bibliotheque.js pour la version complète).
function creerCarteApercu(prompt) {
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

    const actions = document.createElement("div");
    actions.className = "carte-actions";

    const boutonCopier = creerBouton("Copier", "bouton bouton-discret");
    boutonCopier.addEventListener("click", () => copierPrompt(prompt.contenu, boutonCopier));

    actions.append(boutonCopier);
    carte.append(entete, contenu, auteur, actions);
    return carte;
}

function afficherPrompts(prompts) {
    grille.replaceChildren(...prompts.map(creerCarteApercu));
}

// ---------- 6. Actions ----------
async function chargerApercu() {
    try {
        const prompts = await appelerApi(URL_PROMPTS_APERCU);
        afficherPrompts(prompts);
        afficherMessage(messageListe, "", "");
    } catch (erreur) {
        grille.replaceChildren();
        afficherMessage(messageListe, "Impossible de charger la bibliothèque : " + erreur.message, "erreur");
    }
}

async function chargerStats() {
    try {
        const stats = await appelerApi(URL_STATS);
        statTotal.textContent = stats.total_prompts;
        statLikes.textContent = stats.total_likes;

        if (stats.par_categorie.length > 0) {
            const premiere = stats.par_categorie[0];
            statTop.textContent = "Top : " + premiere.categorie + " (" + premiere.nombre + ")";
        } else {
            statTop.textContent = "Aucun prompt pour l'instant";
        }
    } catch (erreur) {
        statTop.textContent = "Statistiques indisponibles";
    }
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

// ---------- 7. Navigation (bande flottante, menu, compte) ----------
// Envoie vers la page de connexion, en retenant où revenir une fois connecté.
function redirigerVersConnexion(destination) {
    try {
        sessionStorage.setItem(CLE_REDIRECTION, destination);
    } catch (erreur) {
        // Pas grave : sans ça, on retombera simplement sur l'accueil après connexion.
    }
    window.location.href = "/connexion";
}

// Un lien vers une page réservée aux connectés (bibliothèque complète, messagerie) :
// sans compte, on détourne le clic vers la connexion plutôt que de laisser le
// visiteur atterrir sur une page qui le renverra de toute façon (voir afficherEtatConnexion).
function protegerLien(lien, destination) {
    lien.addEventListener("click", (evenement) => {
        if (!connecte) {
            evenement.preventDefault();
            redirigerVersConnexion(destination);
        }
    });
}

// La bande se range quand on défile vers le bas, et revient dès qu'on remonte
// (ou qu'on est près du haut de la page).
let dernierScrollY = window.scrollY;

function gererScrollEntete() {
    const y = window.scrollY;
    if (y <= SEUIL_SCROLL_ENTETE) {
        barreNavigation.classList.remove("entete-cachee");
    } else if (y > dernierScrollY) {
        barreNavigation.classList.add("entete-cachee");
        fermerMenu();
    } else {
        barreNavigation.classList.remove("entete-cachee");
    }
    dernierScrollY = y;
}

window.addEventListener("scroll", gererScrollEntete, { passive: true });

// Menu ☰ : une petite liste déroulante, ouverte/fermée au clic.
function ouvrirMenu() {
    menuNavigation.hidden = false;
    boutonMenu.setAttribute("aria-expanded", "true");
}

function fermerMenu() {
    menuNavigation.hidden = true;
    boutonMenu.setAttribute("aria-expanded", "false");
}

boutonMenu.addEventListener("click", (evenement) => {
    evenement.stopPropagation();
    if (menuNavigation.hidden) {
        ouvrirMenu();
    } else {
        fermerMenu();
    }
});

document.addEventListener("click", (evenement) => {
    if (!menuNavigation.hidden && !menuNavigation.contains(evenement.target)) {
        fermerMenu();
    }
});

document.addEventListener("keydown", (evenement) => {
    if (evenement.key === "Escape") {
        fermerMenu();
    }
});

menuNavigation.querySelectorAll("a, button").forEach((element) => {
    element.addEventListener("click", fermerMenu);
});

// La bibliothèque complète et la messagerie sont réservées aux connectés (voir
// protegerLien plus haut) : le lien du menu et le bouton de l'aperçu y mènent tous
// les deux.
protegerLien(lienBibliotheque, "/bibliotheque");
protegerLien(lienBibliothequeComplete, "/bibliotheque");
protegerLien(lienMessagerie, "/#messagerie");

// Compte : connexion, déconnexion ----------
// Affiche l'état "connecté" ou "déconnecté" sur toute la page. Le rôle admin
// vaut pour toute la plateforme (pas seulement la bibliothèque), donc le
// badge s'affiche ici aussi dès que la session le confirme.
function afficherEtatConnexion(nomUtilisateur, estAdmin = false) {
    connecte = Boolean(nomUtilisateur);

    lienConnexion.hidden = connecte;
    blocCompteEntete.hidden = !connecte;

    if (connecte) {
        nomUtilisateurAffiche.textContent = nomUtilisateur;
    }
    badgeAdmin.hidden = !(connecte && estAdmin);
}

async function chargerSession() {
    try {
        const etat = await appelerApi(URL_SESSION);
        afficherEtatConnexion(etat.nom_utilisateur, etat.est_admin);
    } catch (erreur) {
        afficherEtatConnexion(null);
    }
}

boutonDeconnexion.addEventListener("click", async () => {
    boutonDeconnexion.disabled = true;
    try {
        await appelerApi(URL_DECONNEXION, { method: "POST" });
        afficherEtatConnexion(null);
    } catch (erreur) {
        afficherMessage(messageListe, erreur.message, "erreur");
    } finally {
        boutonDeconnexion.disabled = false;
    }
});

// Idée de prompt, fournie par le petit serveur Java (facultatif)
boutonIdee.addEventListener("click", async () => {
    boutonIdee.disabled = true;
    texteIdee.textContent = "Réflexion en cours...";
    try {
        const reponse = await fetch(URL_IDEE_JAVA);
        if (!reponse.ok) {
            throw new Error("Erreur " + reponse.status);
        }
        const donnees = await reponse.json();
        texteIdee.textContent = donnees.idee;
    } catch (erreur) {
        texteIdee.textContent = "Le serveur Java ne répond pas. Lance-le avec la commande du guide (c'est facultatif).";
    } finally {
        boutonIdee.disabled = false;
    }
});

// ---------- 8. Démarrage ----------
appliquerTheme(lireThemeSauvegarde() === "light" ? "light" : "dark");
chargerApercu();
chargerStats();
chargerSession();
