/**
 * Avatar utility functions
 * Handles fetching profile pictures from Google OAuth and Gravatar
 */

import crypto from 'crypto';

/**
 * Generate Gravatar URL from email
 * @param email - User's email address
 * @param size - Image size (default: 200)
 * @returns Gravatar URL
 */
export const getGravatarUrl = (email: string, size: number = 200): string => {
  if (!email) return '';
  
  // Normalize email: trim whitespace and convert to lowercase
  const normalizedEmail = email.trim().toLowerCase();
  
  // Generate MD5 hash of email
  const hash = crypto
    .createHash('md5')
    .update(normalizedEmail)
    .digest('hex');
  
  // Return Gravatar URL with default fallback to identicon
  return `https://www.gravatar.com/avatar/${hash}?s=${size}&d=identicon`;
};

/**
 * Extract profile picture from Google OAuth profile
 * @param profile - Google OAuth profile object
 * @returns Profile picture URL or null
 */
export const getGoogleProfilePicture = (profile: any): string | null => {
  try {
    // Google OAuth provides picture in photos array or picture field
    if (profile.photos && profile.photos.length > 0) {
      return profile.photos[0].value;
    }
    
    if (profile.picture) {
      return profile.picture;
    }
    
    // Check _json field (raw Google API response)
    if (profile._json && profile._json.picture) {
      return profile._json.picture;
    }
    
    return null;
  } catch (error) {
    console.error('Error extracting Google profile picture:', error);
    return null;
  }
};

/**
 * Get the appropriate avatar URL for a user
 * Priority: Custom Avatar > Profile Pic (Google/Gravatar) > Default
 * @param user - User object
 * @returns Avatar URL
 */
export const getUserAvatarUrl = (user: any): string | null => {
  // Priority 1: Custom uploaded avatar
  if (user.isCustomAvatar && user.customAvatarURL) {
    return user.customAvatarURL;
  }
  
  // Priority 2: Fetched profile picture (Google/Gravatar)
  if (user.profilePic) {
    return user.profilePic;
  }
  
  // Priority 3: Legacy avatarUrl field (for backward compatibility)
  if (user.avatarUrl) {
    return user.avatarUrl;
  }
  
  // Priority 4: Generate Gravatar from email
  if (user.email) {
    return getGravatarUrl(user.email);
  }
  
  return null;
};

/**
 * Fetch and set profile picture for user on login/signup
 * @param user - User document
 * @param profile - OAuth profile (optional, for Google OAuth)
 * @returns Updated profile picture URL
 */
export const fetchAndSetProfilePicture = async (
  user: any,
  profile?: any
): Promise<string | null> => {
  try {
    // Don't override if user has custom avatar
    if (user.isCustomAvatar) {
      return user.customAvatarURL;
    }
    
    let profilePicUrl: string | null = null;
    
    // Try to get from Google OAuth first
    if (profile) {
      profilePicUrl = getGoogleProfilePicture(profile);
    }
    
    // Fallback to Gravatar if no Google picture
    if (!profilePicUrl && user.email) {
      profilePicUrl = getGravatarUrl(user.email);
    }
    
    // Update user's profilePic if we found one
    if (profilePicUrl && profilePicUrl !== user.profilePic) {
      user.profilePic = profilePicUrl;
      await user.save();
    }
    
    return profilePicUrl;
  } catch (error) {
    console.error('Error fetching profile picture:', error);
    return null;
  }
};
