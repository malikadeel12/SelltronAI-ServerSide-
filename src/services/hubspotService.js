import { Client as Hubspot } from "@hubspot/api-client";

function getHubspotToken() {
  const token = process.env.HUBSPOT_TOKEN || process.env.VITE_HUBSPOT_TOKEN;
  if (!token) {
    throw new Error("HUBSPOT_TOKEN missing in environment");
  }
  return token;
}

// Custom properties configuration for key highlights
const CUSTOM_PROPERTIES = [
  {
    name: "budget_info",
    label: "Budget Information",
    type: "string",
    fieldType: "text",
    description: "Customer's budget information mentioned in conversation"
  },
  {
    name: "timeline_info", 
    label: "Timeline Information",
    type: "string",
    fieldType: "text",
    description: "Customer's timeline information mentioned in conversation"
  },
  {
    name: "objections_info",
    label: "Objections Information", 
    type: "string",
    fieldType: "text",
    description: "Customer's objections or concerns mentioned in conversation"
  },
  {
    name: "important_info",
    label: "Important Information",
    type: "string", 
    fieldType: "text",
    description: "Other important information mentioned by customer in conversation"
  }
];

// Custom properties configuration for light sentiment
const SENTIMENT_PROPERTIES = [
  {
    name: "light_sentiment",
    label: "Light Sentiment",
    type: "string",
    fieldType: "text",
    description: "Current light sentiment status (green/yellow/red) based on conversation"
  },
  {
    name: "sentiment_score",
    label: "Sentiment Score",
    type: "number",
    fieldType: "number",
    description: "Sentiment analysis score from -1 to 1"
  },
  {
    name: "sentiment_label",
    label: "Sentiment Label",
    type: "string",
    fieldType: "text",
    description: "Sentiment label (positive/neutral/negative)"
  }
];

// Function to create custom properties in HubSpot
export async function createCustomProperties() {
  const token = getHubspotToken();
  const hubspotClient = new Hubspot({ accessToken: token });
  
  console.log("🔧 Creating custom properties in HubSpot...");
  
  for (const prop of CUSTOM_PROPERTIES) {
    try {
      // Try to create the property directly
      // If it already exists, HubSpot will return an error which we'll handle
      await hubspotClient.crm.properties.coreApi.create("contacts", {
        name: prop.name,
        label: prop.label,
        type: prop.type,
        fieldType: prop.fieldType,
        description: prop.description,
        groupName: "contactinformation" // Group under contact information
      });
      
      console.log(`✅ Created property: ${prop.name} (${prop.label})`);
    } catch (error) {
      if (error.statusCode === 409) {
        // Property already exists (409 Conflict)
        console.log(`✅ Property ${prop.name} already exists`);
      } else if (error.statusCode === 400 && error.body?.message?.includes("already exists")) {
        // Alternative check for existing property
        console.log(`✅ Property ${prop.name} already exists`);
      } else {
        console.error(`❌ Failed to create property ${prop.name}:`, error.message);
        console.error(`   Status: ${error.statusCode}, Body:`, error.body);
      }
    }
  }
  
  console.log("🔧 Custom properties setup completed");
  
  // Create sentiment properties
  console.log("🔧 Creating sentiment custom properties in HubSpot...");
  for (const prop of SENTIMENT_PROPERTIES) {
    try {
      await hubspotClient.crm.properties.coreApi.create("contacts", {
        name: prop.name,
        label: prop.label,
        type: prop.type,
        fieldType: prop.fieldType,
        description: prop.description,
        groupName: "contactinformation"
      });
      console.log(`✅ Created property: ${prop.name} (${prop.label})`);
    } catch (error) {
      if (error.statusCode === 409) {
        console.log(`✅ Property ${prop.name} already exists`);
      } else if (error.statusCode === 400 && error.body?.message?.includes("already exists")) {
        console.log(`✅ Property ${prop.name} already exists`);
      } else {
        console.error(`❌ Failed to create property ${prop.name}:`, error.message);
        console.error(`   Status: ${error.statusCode}, Body:`, error.body);
      }
    }
  }
  console.log("🔧 Sentiment custom properties setup completed");
}

function toHubspotProps({ name, email, phoneNumber, companyName }) {
  const props = {};
  if (email) props.email = email;
  if (name) props.firstname = name;
  if (phoneNumber) props.phone = phoneNumber;
  if (companyName) props.company = companyName;
  return props;
}

export async function upsertHubspotContact({ name, email, phoneNumber, companyName }) {
  if (!email) {
    throw new Error("Email is required to upsert HubSpot contact");
  }

  const token = getHubspotToken();
  const hubspotClient = new Hubspot({ accessToken: token });
  const properties = toHubspotProps({ name, email, phoneNumber, companyName });

  try {
    // First try to find existing contact by email
    const existingContact = await getContactByEmail(email);
    
    if (existingContact) {
      // Update existing contact
      const response = await hubspotClient.crm.contacts.basicApi.update(
        existingContact.id,
        { properties }
      );
      return response;
    } else {
      // Create new contact
      const response = await hubspotClient.crm.contacts.basicApi.create(
        { properties }
      );
      return response;
    }
  } catch (error) {
    console.error("HubSpot upsert error:", error);
    throw error;
  }
}


export async function getContactByEmail(email) {
  if (!email) throw new Error("email required");
  const token = getHubspotToken();
  const hubspotClient = new Hubspot({ accessToken: token });
  try {
    const contact = await hubspotClient.crm.contacts.searchApi.doSearch({
      filterGroups: [
        {
          filters: [
            { propertyName: "email", operator: "EQ", value: email },
          ],
        },
      ],
      properties: [
        "email", "firstname", "lastname", "phone", "company"
      ],
      limit: 1,
    });
    return contact.results?.[0] || null;
  } catch (e) {
    if (e?.statusCode === 404) return null;
    throw e;
  }
}

// Function to update HubSpot contact with key highlights
export async function updateContactWithKeyHighlights(email, keyHighlights) {
  if (!email) {
    throw new Error("Email is required to update key highlights");
  }

  if (!keyHighlights || Object.keys(keyHighlights).length === 0) {
    console.log("No key highlights to update");
    return null;
  }

  const token = getHubspotToken();
  const hubspotClient = new Hubspot({ accessToken: token });

  try {
    // First, find the contact by email - only update existing contacts
    const existingContact = await getContactByEmail(email);
    
    if (!existingContact) {
      console.log(`⚠️ No existing contact found with email: ${email} - skipping key highlights update`);
      console.log(`   Key highlights will only sync to existing contacts in HubSpot`);
      return null;
    }

    console.log(`✅ Found existing contact with email: ${email}, ID: ${existingContact.id}`);

    // Prepare properties to update
    const propertiesToUpdate = {};
    
    // Map key highlights to HubSpot custom properties
    if (keyHighlights.budget) {
      propertiesToUpdate.budget_info = keyHighlights.budget;
    }
    if (keyHighlights.timeline) {
      propertiesToUpdate.timeline_info = keyHighlights.timeline;
    }
    if (keyHighlights.objections) {
      propertiesToUpdate.objections_info = keyHighlights.objections;
    }
    if (keyHighlights.importantInfo) {
      propertiesToUpdate.important_info = keyHighlights.importantInfo;
    }

    // Only update if there are properties to update
    if (Object.keys(propertiesToUpdate).length === 0) {
      console.log("⚠️ No valid key highlights to update");
      return null;
    }

    console.log(`💾 Updating existing contact ${existingContact.id} with key highlights:`, propertiesToUpdate);

    // Update the contact with key highlights
    const response = await hubspotClient.crm.contacts.basicApi.update(
      existingContact.id,
      { properties: propertiesToUpdate }
    );

    console.log(`✅ Successfully updated contact ${existingContact.id} with key highlights`);
    return response;
  } catch (error) {
    console.error("Error updating contact with key highlights:", error);
    throw error;
  }
}

// Function to update HubSpot contact with light sentiment
export async function updateContactWithSentiment(email, sentimentData) {
  if (!email) {
    throw new Error("Email is required to update sentiment");
  }

  if (!sentimentData || !sentimentData.color) {
    console.log("No sentiment data to update");
    return null;
  }

  const token = getHubspotToken();
  const hubspotClient = new Hubspot({ accessToken: token });

  try {
    // First, find the contact by email - only update existing contacts
    const existingContact = await getContactByEmail(email);
    
    if (!existingContact) {
      console.log(`⚠️ No existing contact found with email: ${email} - skipping sentiment update`);
      console.log(`   Sentiment will only sync to existing contacts in HubSpot`);
      return null;
    }

    console.log(`✅ Found existing contact with email: ${email}, ID: ${existingContact.id}`);

    // Prepare properties to update
    const propertiesToUpdate = {};
    
    // Map sentiment data to HubSpot custom properties
    if (sentimentData.color) {
      propertiesToUpdate.light_sentiment = sentimentData.color;
    }
    if (sentimentData.score !== undefined && sentimentData.score !== null) {
      propertiesToUpdate.sentiment_score = sentimentData.score;
    }
    if (sentimentData.sentiment) {
      propertiesToUpdate.sentiment_label = sentimentData.sentiment;
    }

    // Only update if there are properties to update
    if (Object.keys(propertiesToUpdate).length === 0) {
      console.log("⚠️ No valid sentiment data to update");
      return null;
    }

    console.log(`💾 Updating existing contact ${existingContact.id} with sentiment:`, propertiesToUpdate);

    try {
      // Update the contact with sentiment
      const response = await hubspotClient.crm.contacts.basicApi.update(
        existingContact.id,
        { properties: propertiesToUpdate }
      );

      console.log(`✅ Successfully updated contact ${existingContact.id} with sentiment`);
      return response;
    } catch (updateError) {
      // If the error is due to missing custom properties, try to create them and retry
      if (updateError.statusCode === 400 && 
          (updateError.body?.message?.toLowerCase().includes('property') ||
           updateError.body?.message?.toLowerCase().includes('invalid property'))) {
        console.log("⚠️ Custom properties may be missing. Attempting to create them...");
        
        try {
          // Try to create the sentiment properties
          for (const prop of SENTIMENT_PROPERTIES) {
            try {
              await hubspotClient.crm.properties.coreApi.create("contacts", {
                name: prop.name,
                label: prop.label,
                type: prop.type,
                fieldType: prop.fieldType,
                description: prop.description,
                groupName: "contactinformation"
              });
              console.log(`✅ Created property: ${prop.name}`);
            } catch (createError) {
              // Property might already exist, which is fine
              if (createError.statusCode !== 409 && 
                  !(createError.statusCode === 400 && createError.body?.message?.includes("already exists"))) {
                console.error(`❌ Failed to create property ${prop.name}:`, createError.message);
              }
            }
          }
          
          // Retry the update after creating properties
          console.log("🔄 Retrying contact update after creating properties...");
          const retryResponse = await hubspotClient.crm.contacts.basicApi.update(
            existingContact.id,
            { properties: propertiesToUpdate }
          );
          console.log(`✅ Successfully updated contact ${existingContact.id} with sentiment after creating properties`);
          return retryResponse;
        } catch (retryError) {
          // If retry also fails, throw the original error
          console.error("❌ Retry after creating properties failed:", retryError.message);
          throw updateError;
        }
      } else {
        // Re-throw the error if it's not a missing property error
        throw updateError;
      }
    }
  } catch (error) {
    console.error("Error updating contact with sentiment:", error);
    
    // Extract more detailed error information
    let errorMessage = error.message || "Unknown error";
    let errorDetails = {};
    
    if (error.response) {
      errorDetails.statusCode = error.response.status;
      errorDetails.statusText = error.response.statusText;
    }
    
    if (error.statusCode) {
      errorDetails.statusCode = error.statusCode;
    }
    
    if (error.body) {
      errorDetails.body = error.body;
      if (error.body.message) {
        errorMessage = error.body.message;
      }
    }
    
    // Handle specific HubSpot API errors
    if (error.statusCode === 404) {
      errorMessage = `Contact not found in HubSpot (ID: ${existingContact?.id})`;
    } else if (error.statusCode === 400) {
      errorMessage = `Invalid request to HubSpot API: ${error.body?.message || errorMessage}. This may be due to missing custom properties.`;
    } else if (error.statusCode === 401 || error.statusCode === 403) {
      errorMessage = `HubSpot authentication failed: ${errorMessage}`;
    }
    
    console.error("Error details:", errorDetails);
    
    const enhancedError = new Error(errorMessage);
    enhancedError.originalError = error;
    enhancedError.details = errorDetails;
    throw enhancedError;
  }
}


