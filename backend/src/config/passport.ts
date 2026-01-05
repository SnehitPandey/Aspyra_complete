import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { User } from '../models/user.model.js';
import { env } from './env.js';
import { getGoogleProfilePicture, getGravatarUrl } from '../utils/avatarUtils.js';

/**
 * Configure Passport Google OAuth 2.0 Strategy
 */
export function configureGoogleAuth() {
  // Skip configuration if Google credentials are not provided
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    console.warn('⚠️  Google OAuth not configured - GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET missing');
    return;
  }

  passport.use(
    new GoogleStrategy(
      {
        clientID: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        callbackURL: env.GOOGLE_CALLBACK_URL,
        scope: ['profile', 'email'],
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          console.log('🔐 Google OAuth callback triggered');
          console.log('📧 Profile:', { id: profile.id, email: profile.emails?.[0]?.value, name: profile.displayName });
          
          // Extract user info from Google profile
          const email = profile.emails?.[0]?.value;
          const name = profile.displayName || profile.name?.givenName || 'User';
          const googleId = profile.id;
          
          // Fetch profile picture from Google
          const googleProfilePic = getGoogleProfilePicture(profile);

          if (!email) {
            console.error('❌ No email found in Google profile');
            return done(new Error('No email found in Google profile'), undefined);
          }

          console.log('🔍 Looking for user with email:', email);
          console.log('🖼️  Google profile picture:', googleProfilePic);
          
          // Check if user already exists
          let user = await User.findOne({ email });

          if (user) {
            console.log('✅ Found existing user:', user.email);
            // Update Google ID and profile picture if not set or not using custom avatar
            if (!user.googleId) {
              user.googleId = googleId;
            }
            
            // Update profilePic only if user doesn't have custom avatar
            if (!user.isCustomAvatar && googleProfilePic) {
              user.profilePic = googleProfilePic;
              // Also update legacy avatarUrl for backward compatibility
              user.avatarUrl = googleProfilePic;
            }
            
            await user.save();
            console.log('📝 Updated user with Google ID and profile picture');
            // Refetch to ensure we have a clean document with _id
            user = await User.findOne({ email });
          } else {
            console.log('👤 Creating new user...');
            
            // Email is guaranteed to exist at this point (checked above)
            if (!email) {
              return done(new Error('Email is required'), undefined);
            }
            
            // Generate username from email (part before @)
            const emailParts = email.split('@');
            const emailUsername = (emailParts[0] || 'user').toLowerCase();
            let username = emailUsername;
            let usernameExists = await User.findOne({ username });
            if (usernameExists) {
              const randomSuffix = Math.floor(Math.random() * 10000);
              username = `${emailUsername}${randomSuffix}`;
            }
            
            // Create new user (no password needed for OAuth users)
            // Set profilePic from Google, with Gravatar as fallback
            const profilePic = googleProfilePic || getGravatarUrl(email);
            
            user = await User.create({
              email,
              name,
              username,
              googleId,
              profilePic,
              avatarUrl: profilePic, // Legacy field for backward compatibility
              isCustomAvatar: false,
              isEmailVerified: true, // Google accounts are pre-verified
            });
            console.log('✅ Created new user:', user.email);
            console.log('🖼️  Profile picture set to:', profilePic);
          }

          if (!user) {
            console.error('❌ Failed to create or find user');
            return done(new Error('Failed to authenticate user'), undefined);
          }

          console.log('🎉 Google OAuth successful, returning user');
          // Convert Mongoose document to Express User type
          const expressUser = {
            id: (user._id || user.id).toString(),
            email: user.email,
            name: user.name,
            role: user.role,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
          };
          console.log('✅ Express user object:', expressUser);
          return done(null, expressUser);
        } catch (error) {
          console.error('❌ Google OAuth error:', error);
          return done(error as Error, undefined);
        }
      }
    )
  );

  // Serialize user for session
  passport.serializeUser((user: any, done) => {
    done(null, user.id);
  });

  // Deserialize user from session
  passport.deserializeUser(async (id: string, done) => {
    try {
      const userDoc = await User.findById(id);
      if (!userDoc) {
        return done(null, null);
      }
      // Convert Mongoose document to Express User type
      const user = {
        id: userDoc._id.toString(),
        email: userDoc.email,
        name: userDoc.name,
        role: userDoc.role,
        createdAt: userDoc.createdAt,
        updatedAt: userDoc.updatedAt,
      };
      done(null, user);
    } catch (error) {
      done(error, null);
    }
  });

  console.log('✅ Google OAuth configured successfully');
}

export default passport;
