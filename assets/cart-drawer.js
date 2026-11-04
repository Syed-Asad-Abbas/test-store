class CartDrawer extends HTMLElement {
  constructor() {
    super();

    this.addEventListener('keyup', (evt) => evt.code === 'Escape' && this.close());
    this.querySelector('#CartDrawer-Overlay').addEventListener('click', this.close.bind(this));
    this.setHeaderCartIconAccessibility();
  }

  setHeaderCartIconAccessibility() {
    const cartLink = document.querySelector('#cart-icon-bubble');
    if (!cartLink) return;

    cartLink.setAttribute('role', 'button');
    cartLink.setAttribute('aria-haspopup', 'dialog');
    cartLink.addEventListener('click', (event) => {
      event.preventDefault();
      this.open(cartLink);
    });
    cartLink.addEventListener('keydown', (event) => {
      if (event.code.toUpperCase() === 'SPACE') {
        event.preventDefault();
        this.open(cartLink);
      }
    });
  }

  open(triggeredBy) {
    if (this.classList.contains('active')) return;
    if (triggeredBy) this.setActiveElement(triggeredBy);
    const cartDrawerNote = this.querySelector('[id^="Details-"] summary');
    if (cartDrawerNote && !cartDrawerNote.hasAttribute('role')) this.setSummaryAccessibility(cartDrawerNote);
    // here the animation doesn't seem to always get triggered. A timeout seem to help
    setTimeout(() => {
      this.classList.add('animate', 'active');
    });

    this.addEventListener(
      'transitionend',
      () => {
        const containerToTrapFocusOn = this.classList.contains('is-empty')
          ? this.querySelector('.drawer__inner-empty')
          : document.getElementById('CartDrawer');
        const focusElement = this.querySelector('.drawer__inner') || this.querySelector('.drawer__close');
        trapFocus(containerToTrapFocusOn, focusElement);
      },
      { once: true },
    );

    document.body.classList.add('overflow-hidden');

    // cart-drawer-items is a CartItems subclass that extends createViewEventElement.
    // Its `view-event-trigger="manual"` skips auto-dispatch on connect; we fire
    // it here when the drawer opens, with `context: 'dialog'` from the payload attribute.
    this.querySelector('cart-drawer-items')?.dispatchViewEvent();

    if (typeof CartRewardCoordinator !== 'undefined') {
      CartRewardCoordinator.sync();
    }
  }

  close() {
    this.classList.remove('active');
    removeTrapFocus(this.activeElement);
    document.body.classList.remove('overflow-hidden');
  }

  setSummaryAccessibility(cartDrawerNote) {
    cartDrawerNote.setAttribute('role', 'button');
    cartDrawerNote.setAttribute('aria-expanded', 'false');

    if (cartDrawerNote.nextElementSibling.getAttribute('id')) {
      cartDrawerNote.setAttribute('aria-controls', cartDrawerNote.nextElementSibling.id);
    }

    cartDrawerNote.addEventListener('click', (event) => {
      event.currentTarget.setAttribute('aria-expanded', !event.currentTarget.closest('details').hasAttribute('open'));
    });

    cartDrawerNote.parentElement.addEventListener('keyup', onKeyUpEscape);
  }

  renderContents(parsedState) {
    this.querySelector('.drawer__inner').classList.contains('is-empty') &&
      this.querySelector('.drawer__inner').classList.remove('is-empty');
    this.productId = parsedState.id;
    this.getSectionsToRender().forEach((section) => {
      const sectionElement = section.selector
        ? document.querySelector(section.selector)
        : document.getElementById(section.id);

      if (!sectionElement) return;
      sectionElement.innerHTML = this.getSectionInnerHTML(parsedState.sections[section.id], section.selector);
    });

    setTimeout(() => {
      this.querySelector('#CartDrawer-Overlay').addEventListener('click', this.close.bind(this));
      this.open();
      if (typeof CartRewardCoordinator !== 'undefined') {
        CartRewardCoordinator.sync(parsedState);
      }
    });
  }

  getSectionInnerHTML(html, selector = '.shopify-section') {
    return new DOMParser().parseFromString(html, 'text/html').querySelector(selector).innerHTML;
  }

  getSectionsToRender() {
    return [
      {
        id: 'cart-drawer',
        selector: '#CartDrawer',
      },
      {
        id: 'cart-icon-bubble',
      },
    ];
  }

  getSectionDOM(html, selector = '.shopify-section') {
    return new DOMParser().parseFromString(html, 'text/html').querySelector(selector);
  }

  setActiveElement(element) {
    this.activeElement = element;
  }
}

customElements.define('cart-drawer', CartDrawer);

class CartDrawerItems extends CartItems {
  getSectionsToRender() {
    return [
      {
        id: 'CartDrawer',
        section: 'cart-drawer',
        selector: '.drawer__inner',
      },
      {
        id: 'cart-icon-bubble',
        section: 'cart-icon-bubble',
        selector: '.shopify-section',
      },
    ];
  }
}

customElements.define('cart-drawer-items', CartDrawerItems);

/* ==========================================================================
 * TASK 2: Cart Reward & Free Gift Architecture
 * Granular Vanilla JavaScript Functions
 * ========================================================================== */

/**
 * Formats cents into currency string based on Shopify money format template.
 * @param {number|string} cents - Total amount in cents
 * @param {string} [formatString] - Format template, defaults to '${{amount}}'
 * @returns {string} Formatted money string
 */
function formatCartRewardMoney(cents, formatString) {
  if (typeof cents === 'string') cents = cents.replace('.', '');
  let value = '';
  const placeholderRegex = /\{\{\s*(\w+)\s*\}\}/;
  const format = formatString || '${{amount}}';

  function defaultOption(opt, def) {
    return typeof opt === 'undefined' ? def : opt;
  }

  function formatWithDelimiters(number, precision, thousands, decimal) {
    precision = defaultOption(precision, 2);
    thousands = defaultOption(thousands, ',');
    decimal = defaultOption(decimal, '.');

    if (isNaN(number) || number == null) return '0';

    number = (number / 100.0).toFixed(precision);

    const parts = number.split('.');
    const dollars = parts[0].replace(/(\d)(?=(\d\d\d)+(?!\d))/g, '$1' + thousands);
    const centsPart = parts[1] ? decimal + parts[1] : '';

    return dollars + centsPart;
  }

  const match = format.match(placeholderRegex);
  const matchType = match ? match[1] : 'amount';

  switch (matchType) {
    case 'amount':
      value = formatWithDelimiters(cents, 2);
      break;
    case 'amount_no_decimals':
      value = formatWithDelimiters(cents, 0);
      break;
    case 'amount_with_comma_separator':
      value = formatWithDelimiters(cents, 2, '.', ',');
      break;
    case 'amount_no_decimals_with_comma_separator':
      value = formatWithDelimiters(cents, 0, '.', ',');
      break;
    default:
      value = formatWithDelimiters(cents, 2);
  }

  return format.replace(placeholderRegex, value);
}

/**
 * Checks whether a cart line item represents the automatic free gift reward.
 * @param {Object} item - Cart line item
 * @param {string|number} [giftVariantId] - Expected gift variant ID
 * @returns {boolean}
 */
function isCartItemFreeGift(item, giftVariantId) {
  if (!item) return false;
  if (item.properties && (item.properties._is_free_gift === 'true' || item.properties['_is_free_gift'] === 'true')) {
    return true;
  }
  if (giftVariantId && String(item.variant_id) === String(giftVariantId)) {
    return true;
  }
  return false;
}

/**
 * Calculates the qualifying subtotal in cents by excluding any automatic free gift item.
 * @param {Array<Object>} cartItems - Array of cart line items
 * @param {string|number} [giftVariantId] - Gift variant ID
 * @returns {number} Qualifying subtotal in cents
 */
function calculateQualifyingSubtotal(cartItems, giftVariantId) {
  if (!Array.isArray(cartItems)) return 0;
  return cartItems.reduce((total, item) => {
    if (isCartItemFreeGift(item, giftVariantId)) {
      return total;
    }
    return total + (item.final_line_price != null ? item.final_line_price : item.line_price || 0);
  }, 0);
}

/**
 * Calculates progress percentage clamped between 0% and 100%.
 * @param {number} qualifyingSubtotalCents - Subtotal in cents
 * @param {number} thresholdCents - Threshold in cents (e.g. 15000 for $150)
 * @returns {number} Progress percentage (0 to 100)
 */
function calculateRewardProgress(qualifyingSubtotalCents, thresholdCents) {
  if (!thresholdCents || thresholdCents <= 0) return 0;
  const progress = (qualifyingSubtotalCents / thresholdCents) * 100;
  return Math.min(100, Math.max(0, progress));
}

/**
 * Calculates the remaining amount needed in cents, never below 0.
 * @param {number} qualifyingSubtotalCents - Subtotal in cents
 * @param {number} thresholdCents - Threshold in cents
 * @returns {number} Remaining amount in cents
 */
function calculateRewardRemaining(qualifyingSubtotalCents, thresholdCents) {
  return Math.max(0, thresholdCents - qualifyingSubtotalCents);
}

/**
 * Finds the free gift item in the cart if present.
 * @param {Array<Object>} cartItems - Array of cart line items
 * @param {string|number} giftVariantId - Gift variant ID
 * @returns {Object|null}
 */
function findFreeGiftInCart(cartItems, giftVariantId) {
  if (!Array.isArray(cartItems)) return null;
  return cartItems.find((item) => isCartItemFreeGift(item, giftVariantId)) || null;
}

/**
 * Updates DOM elements for the reward progress bar and messages.
 * @param {HTMLElement} rewardElement - The #CartDrawer-Reward container
 * @param {number} qualifyingSubtotalCents - Qualifying subtotal in cents
 * @param {number} thresholdCents - Threshold in cents
 * @param {string} moneyFormat - Currency money format template
 */
function updateCartRewardUI(rewardElement, qualifyingSubtotalCents, thresholdCents, moneyFormat) {
  if (!rewardElement) return;

  const progressPercent = calculateRewardProgress(qualifyingSubtotalCents, thresholdCents);
  const remainingCents = calculateRewardRemaining(qualifyingSubtotalCents, thresholdCents);
  const isUnlocked = qualifyingSubtotalCents >= thresholdCents;

  // 1. Update progress indicator width
  const indicator = rewardElement.querySelector('[data-reward-indicator]');
  if (indicator) {
    indicator.style.width = `${progressPercent}%`;
  }

  // 2. Update progressbar ARIA value
  const progressBar = rewardElement.querySelector('[role="progressbar"]');
  if (progressBar) {
    progressBar.setAttribute('aria-valuenow', Math.round(progressPercent));
  }

  // 3. Update remaining text
  const remainingText = rewardElement.querySelector('[data-reward-remaining]');
  if (remainingText) {
    remainingText.textContent = formatCartRewardMoney(remainingCents, moneyFormat);
  }

  // 4. Toggle messages visibility
  const lockedMsg = rewardElement.querySelector('[data-reward-locked-msg]');
  const unlockedMsg = rewardElement.querySelector('[data-reward-unlocked-msg]');
  if (lockedMsg) lockedMsg.classList.toggle('hidden', isUnlocked);
  if (unlockedMsg) unlockedMsg.classList.toggle('hidden', !isUnlocked);

  // 5. Update milestone badge (Dynamic Traveling Truck Journey)
  const milestone = rewardElement.querySelector('[data-reward-milestone]');
  if (milestone) {
    milestone.style.left = `${progressPercent}%`;
    milestone.classList.toggle('is-completed', isUnlocked);
  }

  // 6. Update reward labels
  const shippingLabel = rewardElement.querySelector('[data-reward-shipping-label]');
  const giftLabel = rewardElement.querySelector('[data-reward-gift-label]');
  if (shippingLabel) {
    shippingLabel.classList.toggle('is-unlocked', isUnlocked);
    const statusSpan = shippingLabel.querySelector('.cart-drawer-reward__label-status');
    if (statusSpan) statusSpan.textContent = isUnlocked ? '✓' : '';
  }
  if (giftLabel) {
    giftLabel.classList.toggle('is-unlocked', isUnlocked);
    const statusSpan = giftLabel.querySelector('.cart-drawer-reward__label-status');
    if (statusSpan) statusSpan.textContent = isUnlocked ? '✓' : '';
  }

  // 7. Update root unlocked class
  rewardElement.classList.toggle('is-unlocked', isUnlocked);
}

/**
 * Singleton manager to coordinate cart inspection, reward progress, and gift sync.
 */
class CartRewardCoordinator {
  static isSyncing = false;
  static defaultThresholdCents = 15000;
  static defaultGiftVariantId = '15423696765037';

  /**
   * Fetches the latest full cart state via /cart.js.
   * @returns {Promise<Object>}
   */
  static async fetchCartState() {
    try {
      const response = await fetch(`${routes.cart_url}.js`, {
        headers: { Accept: 'application/json' },
      });
      return await response.json();
    } catch (error) {
      console.error('Failed to fetch latest cart:', error);
      return null;
    }
  }

  /**
   * Refreshes the cart drawer HTML in-place via Dawn's Section Rendering API.
   *
   * Replaces the full #CartDrawer element so Liquid-computed data (qualifying
   * subtotal, progress %, gift rows) is always accurate. Also refreshes the
   * cart-icon bubble and re-attaches the overlay close listener.
   *
   * @returns {Promise<void>}
   */
  static async refreshDrawerMarkup() {
    try {
      const response = await fetch(`${routes.cart_url}?section_id=cart-drawer`);
      const htmlText = await response.text();
      const parsedDOM = new DOMParser().parseFromString(htmlText, 'text/html');

      // Replace the full #CartDrawer (not just .drawer__inner) so the
      // cart-drawer-items custom element, overlay, and all data-attributes
      // are fully re-hydrated from the server-rendered Liquid.
      const cartDrawerEl = document.querySelector('#CartDrawer');
      const freshCartDrawer = parsedDOM.querySelector('#CartDrawer');
      if (cartDrawerEl && freshCartDrawer) {
        cartDrawerEl.innerHTML = freshCartDrawer.innerHTML;
      }

      // Re-attach overlay click handler after innerHTML replacement
      const overlay = document.querySelector('#CartDrawer-Overlay');
      const drawerCustomEl = document.querySelector('cart-drawer');
      if (overlay && drawerCustomEl) {
        overlay.addEventListener('click', drawerCustomEl.close.bind(drawerCustomEl));
      }

      // Also refresh header cart icon bubble
      const bubbleResponse = await fetch(`${routes.cart_url}?section_id=cart-icon-bubble`);
      const bubbleText = await bubbleResponse.text();
      const bubbleDOM = new DOMParser().parseFromString(bubbleText, 'text/html');
      const bubbleContainer = document.querySelector('#cart-icon-bubble');
      const freshBubble = bubbleDOM.querySelector('#cart-icon-bubble') || bubbleDOM.querySelector('.shopify-section');
      if (bubbleContainer && freshBubble) {
        bubbleContainer.innerHTML = freshBubble.innerHTML;
      }
    } catch (error) {
      console.error('[CartRewardCoordinator] Failed to refresh drawer markup:', error);
    }
  }

  /**
   * Adds the automatic free gift to cart via POST /cart/add.js.
   *
   * IMPORTANT: This function must NOT call cartDrawer.renderContents() or
   * CartRewardCoordinator.sync() — both of which trigger re-entry while
   * isSyncing=true, creating a deadlock. Instead it calls refreshDrawerMarkup()
   * which fetches fresh section HTML independently and re-paints the drawer.
   *
   * @param {string|number} variantId - Gift variant ID
   * @returns {Promise<boolean>}
   */
  static async addGiftItem(variantId) {
    if (!variantId) {
      console.warn('[CartRewardCoordinator] Cannot add gift: missing variant ID');
      return false;
    }

    try {
      const addUrl = `${window.routes?.cart_add_url || '/cart/add'}.js`;

      // Build JSON payload — most reliable for /cart/add.js with line properties
      const payload = {
        id: Number(variantId),
        quantity: 1,
        properties: {
          _is_free_gift: 'true',
          Reward: 'Free Gift ($150+ Order)',
        },
      };

      console.log('[CartRewardCoordinator] Adding free gift variant ID:', variantId, 'payload:', payload);

      const response = await fetch(addUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      console.log('[CartRewardCoordinator] /cart/add.js response (status', response.status, '):', data);

      if (!response.ok || data.status) {
        console.error(
          '[CartRewardCoordinator] ❌ Shopify rejected gift variant ID', variantId,
          '— HTTP', response.status,
          '—', data.description || data.message || 'Unknown error'
        );
        console.error('[CartRewardCoordinator] Make sure variant ID', variantId, 'exists and is in-stock in your store.');
        return false;
      }

      console.log('[CartRewardCoordinator] ✅ Gift added successfully. Refreshing drawer...');

      // Refresh the drawer markup via Section Rendering API.
      // Do NOT call cartDrawer.renderContents() here — that would call sync()
      // while isSyncing=true and silently deadlock the entire coordinator.
      await CartRewardCoordinator.refreshDrawerMarkup();

      // Update the is-empty class on the cart-drawer element if needed
      const cartDrawer = document.querySelector('cart-drawer');
      if (cartDrawer) {
        cartDrawer.classList.remove('is-empty');
      }

      return true;
    } catch (error) {
      console.error('[CartRewardCoordinator] Exception adding automatic free gift:', error);
      return false;
    }
  }

  /**
   * Removes the automatic free gift from cart via POST /cart/change.js.
   *
   * IMPORTANT: Same as addGiftItem — must NOT call cartDrawer.renderContents()
   * or CartRewardCoordinator.sync() due to isSyncing deadlock. Uses
   * refreshDrawerMarkup() instead.
   *
   * @param {string} lineKey - Line item key of the gift
   * @returns {Promise<boolean>}
   */
  static async removeGiftItem(lineKey) {
    try {
      const changeUrl = `${window.routes?.cart_change_url || '/cart/change'}.js`;

      console.log('[CartRewardCoordinator] Removing free gift line key:', lineKey);

      const response = await fetch(changeUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'application/json',
        },
        body: JSON.stringify({ id: lineKey, quantity: 0 }),
      });

      const data = await response.json();
      console.log('[CartRewardCoordinator] /cart/change.js remove response (status', response.status, '):', data);

      if (!response.ok || data.status) {
        console.error('[CartRewardCoordinator] ❌ Failed to remove gift:', data.description || data.message);
        return false;
      }

      console.log('[CartRewardCoordinator] ✅ Gift removed. Refreshing drawer...');

      // Refresh the drawer markup via Section Rendering API.
      // Do NOT call cartDrawer.renderContents() — same deadlock risk as addGiftItem.
      await CartRewardCoordinator.refreshDrawerMarkup();

      return true;
    } catch (error) {
      console.error('[CartRewardCoordinator] Exception removing automatic free gift:', error);
      return false;
    }
  }

  /**
   * Main synchronization entry point. Checks eligibility and reconciles gift state.
   *
   * Guards against re-entrant calls via isSyncing. The addGiftItem / removeGiftItem
   * helpers are designed to NOT call back into sync() so there is no deadlock.
   *
   * @param {Object} [providedCartData] - Optional existing cart state (must have items[])
   */
  static async sync(providedCartData) {
    if (this.isSyncing) {
      // Queue one deferred retry so a sync requested during an ongoing sync
      // is not silently dropped (e.g. when PUB_SUB fires during addGiftItem).
      if (!this._syncQueued) {
        this._syncQueued = true;
        setTimeout(() => {
          this._syncQueued = false;
          CartRewardCoordinator.sync();
        }, 500);
      }
      return;
    }
    this.isSyncing = true;

    try {
      const rewardEl = document.getElementById('CartDrawer-Reward');
      const thresholdCents = rewardEl
        ? parseInt(rewardEl.dataset.threshold, 10) || this.defaultThresholdCents
        : this.defaultThresholdCents;
      const giftVariantId = rewardEl
        ? rewardEl.dataset.giftVariantId || this.defaultGiftVariantId
        : this.defaultGiftVariantId;
      const moneyFormat = rewardEl?.dataset.moneyFormat || '${{amount}}';

      // providedCartData from product-form.js is the /cart/add.js response which
      // has items as a single object (not an array). Always fetch the full cart to
      // get accurate item_count and all line items.
      let cart = (providedCartData && Array.isArray(providedCartData.items))
        ? providedCartData
        : null;

      if (!cart) {
        cart = await this.fetchCartState();
      }
      if (!cart || !Array.isArray(cart.items)) {
        return;
      }

      // 1. Calculate qualifying subtotal (gift strictly excluded)
      const qualifyingSubtotal = calculateQualifyingSubtotal(cart.items, giftVariantId);
      const isEligible = qualifyingSubtotal >= thresholdCents;
      const existingGift = findFreeGiftInCart(cart.items, giftVariantId);
      const isDeclined = sessionStorage.getItem('free_gift_declined') === 'true';

      // 2. Update progress bar UI immediately with current data
      if (rewardEl) {
        updateCartRewardUI(rewardEl, qualifyingSubtotal, thresholdCents, moneyFormat);
      }

      // 3. Update count in drawer heading if present
      const headingCount = document.querySelector('[data-cart-count]');
      if (headingCount) {
        headingCount.textContent = cart.item_count || 0;
      }

      // 4. Handle gift eligibility transition
      if (!isEligible) {
        // Reset customer decline state when subtotal falls below $150
        if (isDeclined) {
          sessionStorage.removeItem('free_gift_declined');
        }
        // If gift is in cart but no longer eligible, remove it
        if (existingGift) {
          console.log('[CartRewardCoordinator] Below threshold — removing gift from cart');
          await this.removeGiftItem(existingGift.key);
        }
      } else {
        // Qualifying subtotal >= $150
        if (!existingGift && !isDeclined) {
          console.log('[CartRewardCoordinator] Threshold met — adding gift to cart');
          await this.addGiftItem(giftVariantId);
        }
      }
    } catch (err) {
      console.error('[CartRewardCoordinator] Error during sync:', err);
    } finally {
      this.isSyncing = false;
    }
  }

  /**
   * Initializes listeners on the document to react to cart updates.
   */
  static init() {
    // Intercept manual removal of free gift to respect customer intent
    document.addEventListener('click', (event) => {
      const removeBtn = event.target.closest('[data-is-free-gift="true"]');
      if (removeBtn) {
        sessionStorage.setItem('free_gift_declined', 'true');
      }
    });

    // Subscribe to Dawn's PUB_SUB_EVENTS if available
    if (typeof subscribe === 'function' && typeof PUB_SUB_EVENTS !== 'undefined') {
      subscribe(PUB_SUB_EVENTS.cartUpdate, (event) => {
        CartRewardCoordinator.sync(event?.cartData);
      });
    }

    // Run initial check on DOM ready
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        CartRewardCoordinator.sync();
      });
    } else {
      CartRewardCoordinator.sync();
    }
  }
}

CartRewardCoordinator.init();
